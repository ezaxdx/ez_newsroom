// 소스·키워드 추가 화면의 "미리보기" — 저장하기 전에 실제로 기사가 수집되는지, 어떤 방식으로 수집되는지 확인
// DB 에 아무것도 쓰지 않는 읽기 전용. 실제 수집과 같은 서버(IP)에서 같은 코드로 실행되므로 결과가 가장 정확함.
import type { FetchEnv, ListConfig, RawItem } from "./fetchers.ts";
import {
  extractListItems, fetchJsonList, fetchNaverSearch, fetchGoogleSearch, fetchWebList, parseRSS, renderAndExtract,
} from "./fetchers.ts";
import { CHROME_UA, decodeEntities, getPath, isSameStory, parseDateLoose, toISO, withTimeout } from "./util.ts";

export interface PreviewInput {
  kind: "source" | "keyword";
  url?: string;                          // kind=source: 목록 페이지·RSS·JSON 주소
  keyword?: string;                      // kind=keyword
  engines?: string[];                    // kind=keyword: ["naver","google"]
  source_type?: string;                  // 수정 시 기존 방식 유지 (없으면 자동 판별)
  fetch_config?: ListConfig;
  keyword_mode?: "none" | "default" | "custom";
  custom_keywords?: string[];
  focus_keywords?: string[];             // "기본 관심 키워드" (설정에서 읽어 전달)
}
export interface PreviewItem { title: string; link: string; pubDate: string; matched?: boolean; via?: string }
export interface PreviewResult {
  ok: boolean;
  detected_type?: "rss" | "web_list" | "json_list" | "keyword_search";
  mode?: "direct" | "render";
  page_title?: string;
  suggested_url?: string;                // 페이지에 숨은 RSS 주소를 찾아 대신 쓴 경우
  fetch_config?: ListConfig;             // 자동으로 추정한 설정 (JSON 필드 매핑 등)
  items: PreviewItem[];
  total: number;
  matched?: number;                      // "가져올 기사" 조건에 맞는 개수
  engines?: Record<string, { count: number; recent7d: number; error?: string }>;
  overlap?: number;
  error?: string;
  hint?: string;
  elapsed_ms: number;
}

const FIELD_GUESS = {
  title: ["title", "subject", "headline", "name"],
  body: ["content", "body", "contents", "description", "summary"],
  date: ["createDt", "regDt", "createdAt", "created_at", "registDt", "publishedAt", "pubDate", "writeDt", "insertDt", "date"],
  id: ["postNo", "id", "no", "seq", "idx", "articleId", "boardNo"],
};
const LIST_KEYS = ["list", "items", "data", "results", "rows", "posts", "articles", "content"];

function guessFields(row: Record<string, unknown>) {
  const pick = (cands: string[]) => cands.find((k) => k in row && row[k] != null);
  return { title: pick(FIELD_GUESS.title), body: pick(FIELD_GUESS.body), date: pick(FIELD_GUESS.date), id: pick(FIELD_GUESS.id) };
}
function findArray(json: unknown): { path: string; list: Record<string, unknown>[] } | null {
  if (Array.isArray(json)) return json.length && typeof json[0] === "object" ? { path: "", list: json as Record<string, unknown>[] } : null;
  if (json && typeof json === "object") {
    for (const k of LIST_KEYS) {
      const v = (json as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return { path: k, list: v as Record<string, unknown>[] };
    }
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return { path: k, list: v as Record<string, unknown>[] };
    }
  }
  return null;
}
const pageTitle = (html: string) => decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()).replace(/\s*[|\-–]\s*.*$/, "").slice(0, 40);

function applyMatch(items: RawItem[], input: PreviewInput): PreviewItem[] {
  const mode = input.keyword_mode ?? "none";
  const kws = (mode === "custom" ? input.custom_keywords : mode === "default" ? input.focus_keywords : [])?.map((k) => k.toLowerCase()) ?? [];
  return items.map((it) => ({
    title: it.title, link: it.link, pubDate: toISO(parseDateLoose(it.pubDate)) ?? it.pubDate, via: it.via,
    matched: mode === "none" ? true : kws.some((k) => it.title.toLowerCase().includes(k)),
  }));
}
function finish(r: Omit<PreviewResult, "elapsed_ms" | "total" | "items" | "matched">, items: RawItem[], input: PreviewInput, t0: number): PreviewResult {
  const list = applyMatch(items, input);
  return { ...r, items: list.slice(0, 40), total: items.length, matched: list.filter((i) => i.matched).length, elapsed_ms: Date.now() - t0 };
}

export async function previewSource(input: PreviewInput, env: FetchEnv): Promise<PreviewResult> {
  const t0 = Date.now();
  try {
    return await withTimeout(run(input, env, t0), 55000, "미리보기");
  } catch (e) {
    return { ok: false, items: [], total: 0, error: (e as Error).message, elapsed_ms: Date.now() - t0 };
  }
}

async function run(input: PreviewInput, env: FetchEnv, t0: number): Promise<PreviewResult> {
  /* ── 검색 키워드 ── */
  if (input.kind === "keyword") {
    const kw = (input.keyword ?? "").trim();
    if (!kw) return { ok: false, items: [], total: 0, error: "키워드를 입력하세요", elapsed_ms: Date.now() - t0 };
    const engines = input.engines?.length ? input.engines : ["naver"];
    const weekAgo = Date.now() - 7 * 86400000;
    const per: Record<string, RawItem[]> = {};
    const info: NonNullable<PreviewResult["engines"]> = {};
    await Promise.all(engines.map(async (e) => {
      try {
        const r = e === "naver" ? await fetchNaverSearch(kw, env, 20) : await fetchGoogleSearch(kw);
        per[e] = r.items;
        info[e] = { count: r.items.length, recent7d: r.items.filter((it) => (parseDateLoose(it.pubDate) ?? 0) >= weekAgo).length };
      } catch (err) {
        per[e] = [];
        info[e] = { count: 0, recent7d: 0, error: (err as Error).message };
      }
    }));
    const all = engines.flatMap((e) => (per[e] ?? []).map((it) => ({ ...it, via: e })));
    let overlap = 0;
    if (per.naver?.length && per.google?.length) overlap = per.google.filter((g) => per.naver.some((n) => isSameStory(g.title, n.title))).length;
    const okAny = Object.values(info).some((i) => !i.error && i.count > 0);
    all.sort((a, b) => (parseDateLoose(b.pubDate) ?? 0) - (parseDateLoose(a.pubDate) ?? 0));
    return finish({ ok: okAny, detected_type: "keyword_search", engines: info, overlap, error: okAny ? undefined : Object.values(info).map((i) => i.error).filter(Boolean).join(" / ") || "검색 결과가 없습니다" }, all, { ...input, keyword_mode: "none" }, t0);
  }

  /* ── 지정 소스 ── */
  const url = (input.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, items: [], total: 0, error: "http(s):// 로 시작하는 주소를 입력하세요", elapsed_ms: Date.now() - t0 };
  const cfg = input.fetch_config ?? {};
  const type = input.source_type;

  // 수정 화면: 기존 방식 그대로 확인
  if (type === "web_list" || type === "url") {
    const r = await fetchWebList(url, cfg, env);
    return finish({ ok: r.items.length > 0, detected_type: "web_list", mode: (r.mode as "direct" | "render") ?? "direct", fetch_config: cfg, error: r.items.length ? undefined : (r.error ?? "기사를 찾지 못했습니다") }, r.items, input, t0);
  }
  if (type === "json_list") {
    const r = await fetchJsonList(url, cfg);
    return finish({ ok: r.items.length > 0, detected_type: "json_list", fetch_config: cfg, error: r.items.length ? undefined : "기사를 찾지 못했습니다" }, r.items, input, t0);
  }

  // 1) 주소를 열어 종류 판별
  const res = await fetch(url, { headers: { "User-Agent": CHROME_UA, "Accept": "text/html,application/xhtml+xml,application/xml,application/json,*/*", "Accept-Language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!res.ok) return { ok: false, items: [], total: 0, error: `주소를 열 수 없습니다 (HTTP ${res.status})`, hint: res.status === 401 || res.status === 403 ? "접근이 막힌 주소입니다. 로그인이 필요하거나 봇을 차단하는 사이트일 수 있어요." : res.status === 404 ? "주소가 바뀌었거나 사라진 페이지입니다." : undefined, elapsed_ms: Date.now() - t0 };
  const ctype = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const head = body.slice(0, 2000);

  // JSON
  if (/json/i.test(ctype) || /^\s*[\[{]/.test(head)) {
    let json: unknown;
    try { json = JSON.parse(body); } catch { return { ok: false, items: [], total: 0, error: "JSON 해석에 실패했습니다", elapsed_ms: Date.now() - t0 }; }
    const found = findArray(json);
    if (!found) return { ok: false, detected_type: "json_list", items: [], total: 0, error: "JSON 안에서 기사 목록을 찾지 못했습니다", hint: "고급 설정에서 목록 위치(list_path)를 직접 지정하세요.", elapsed_ms: Date.now() - t0 };
    const f = guessFields(found.list[0]);
    const sample = found.list.slice(0, 5).map((row) => ({ title: String(getPath(row, f.title ?? "title") ?? ""), id: String(getPath(row, f.id ?? "id") ?? "") })).filter((x) => x.title);
    const linkField = ["url", "link", "href"].find((k) => typeof found.list[0][k] === "string");
    const guessed: ListConfig = { list_path: found.path, fields: { title: f.title, body: f.body, date: f.date, id: f.id, ...(linkField ? { link: linkField } : {}) } };
    if (!linkField) {
      return { ok: false, detected_type: "json_list", fetch_config: guessed, items: sample.map((s) => ({ title: s.title, link: "", pubDate: "" })), total: found.list.length, error: "목록은 찾았지만 기사 링크를 만들 방법을 알 수 없습니다", hint: "고급 설정의 link_template 에 기사 주소 형식을 입력하세요. 예: https://사이트/view?no={id}", elapsed_ms: Date.now() - t0 };
    }
    const r = await fetchJsonList(url, guessed);
    return finish({ ok: r.items.length > 0, detected_type: "json_list", fetch_config: guessed, error: r.items.length ? undefined : "기사를 찾지 못했습니다" }, r.items, input, t0);
  }

  // RSS / Atom
  if (/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head) || /xml/i.test(ctype)) {
    const items = parseRSS(body).map((it) => { try { return { ...it, link: new URL(it.link, url).toString() }; } catch { return it; } });
    const title = decodeEntities((body.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1] ?? body.match(/<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim()).slice(0, 40);
    return finish({ ok: items.length > 0, detected_type: "rss", page_title: title, error: items.length ? undefined : "RSS 는 열렸지만 기사가 없습니다" }, items, input, t0);
  }

  // HTML — 숨은 RSS 주소가 있으면 그걸 우선 사용
  const alt = body.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
  const altHref = alt?.match(/href=["']([^"']+)["']/i)?.[1];
  if (altHref) {
    try {
      const rssUrl = new URL(decodeEntities(altHref), url).toString();
      const r = await fetch(rssUrl, { headers: { "User-Agent": CHROME_UA }, signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const items = parseRSS(await r.text()).map((it) => { try { return { ...it, link: new URL(it.link, rssUrl).toString() }; } catch { return it; } });
        if (items.length) return finish({ ok: true, detected_type: "rss", page_title: pageTitle(body), suggested_url: rssUrl }, items, input, t0);
      }
    } catch { /* 숨은 RSS 실패 — 목록 페이지 방식으로 계속 */ }
  }
  const direct = extractListItems(body, url, cfg);
  if (direct.length >= 2) return finish({ ok: true, detected_type: "web_list", mode: "direct", page_title: pageTitle(body), fetch_config: cfg }, direct, input, t0);

  // 직접 읽어서 0건이면 JS로 목록을 그리는 사이트일 수 있어 렌더링 서비스로 한 번 더
  try {
    const rendered = await renderAndExtract(url, cfg, env);
    if (rendered.length >= 2) return finish({ ok: true, detected_type: "web_list", mode: "render", page_title: pageTitle(body), fetch_config: cfg, hint: "이 사이트는 JavaScript로 목록을 불러와서 렌더링 서비스를 거쳐 수집합니다 (시간이 조금 더 걸려요)." }, rendered, input, t0);
  } catch { /* 렌더링도 실패 */ }
  return { ok: false, detected_type: "web_list", page_title: pageTitle(body), items: [], total: 0, error: "기사를 찾지 못했어요", hint: "목록을 특별한 방식으로 불러오는 사이트일 수 있어요. 데이터 주소를 알면 고급 설정에 입력하고, 모르면 개발 지원을 요청해 주세요.", elapsed_ms: Date.now() - t0 };
}
