// curate-v2 수집기 — 소스 한 개의 "목록"만 가져옴 (원문은 열지 않음)
import {
  CHROME_UA, decodeEntities, extractText, extractOgImage, extractPublishedDate,
  getPath, parseDateLoose, sleep, toISO,
} from "./util.ts";

export interface RawItem {
  title: string;
  link: string;
  pubDate: string;          // ISO 또는 원문 표기, 모르면 ""
  description: string;
  bodyText?: string;        // JSON API처럼 목록에 본문이 이미 있는 경우
  via?: string;             // naver | google | rss ...
}
export interface FetchResult {
  items: RawItem[];
  error?: string;           // 있으면 "수집 실패"로 기록 (0건과 구분)
  mode?: string;            // direct | render
}
export interface ListConfig {
  request?: { method?: string; form?: Record<string, string>; headers?: Record<string, string> };
  region?: { start: string; end?: string };   // 페이지에서 본문 목록 영역만 잘라 쓰기 (사이드바·인기기사 제외)
  link_pattern?: string;                      // 기사 링크만 통과시키는 정규식
  urls?: string[];                            // 같은 방식으로 추가로 가져올 주소들 (섹션별 목록 등)
  render?: boolean;                           // true: 처음부터 렌더링 / false: 렌더링 안 씀 / 미지정: 0건이면 자동 렌더링
  // JSON API
  list_path?: string;
  fields?: { title?: string; body?: string; date?: string; id?: string; link?: string };
  link_template?: string;                     // 예: https://.../news-detail.do?postNo={id}
  headers?: Record<string, string>;
  engines?: string[];                         // 검색 키워드: ["naver","google"]
}

export interface FetchEnv {
  naverId?: string;
  naverSecret?: string;
  jinaKey?: string;
}

/* ── 공통 HTTP ── */
async function httpGet(url: string, init: RequestInit & { timeoutMs?: number } = {}, tries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 12000) });
      return res;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(800);
    }
  }
  throw lastErr;
}

/* ── RSS ── */
async function fetchXmlText(url: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": CHROME_UA,
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  };
  if (url.includes("news.google.com")) headers["Cookie"] = "CONSENT=YES+cb.20210328-17-p0.en+FX+000";
  const res = await httpGet(url, { headers });
  // v1은 401/404 응답도 "0건"으로 넘겨서 마이스iN이 몇 달간 조용히 죽어 있었음 → 상태 코드를 오류로 처리
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sniff = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200));
  const encMatch = sniff.match(/encoding=["']([^"']+)["']/i) ?? res.headers.get("content-type")?.match(/charset=([^\s;]+)/i);
  const encoding = (encMatch?.[1] ?? "utf-8").toLowerCase().replace("-", "");
  const text = new TextDecoder(encoding.includes("euckr") || encoding.includes("949") ? "euc-kr" : "utf-8", { fatal: false }).decode(buffer);
  return text;
}
function cdata(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}
export function parseRSS(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
  for (const m of matches) {
    const c = m[1];
    const title = decodeEntities(cdata(c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
    const link = cdata(c.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? c.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? "");
    const pubDate = (c.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]
      ?? c.match(/<published>([\s\S]*?)<\/published>/i)?.[1]
      ?? c.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] ?? "").trim();
    const rawBody =
      c.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)?.[1] ??
      c.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ??
      c.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ??
      c.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
    const description = extractText(decodeEntities(cdata(rawBody)));
    if (title && link) items.push({ title, link: decodeEntities(link), pubDate, description });
  }
  return items;
}
function toAbsolute(link: string, base: string): string {
  try { return new URL(link, base).toString(); } catch { return link; }
}
export async function fetchRss(url: string): Promise<FetchResult> {
  const xml = await fetchXmlText(url);
  // 상대 경로 링크(K-mice 등)는 피드 주소 기준으로 절대 주소로 변환 — v1 의 toAbsoluteUrl 과 같은 처리
  const items = parseRSS(xml).map((it) => ({ ...it, link: toAbsolute(it.link, url) }));
  if (items.length === 0 && /<html[\s>]/i.test(xml.slice(0, 2000)) && !/<rss|<feed/i.test(xml.slice(0, 2000))) {
    throw new Error("RSS 대신 HTML 페이지가 응답됨 (차단 또는 주소 오류)");
  }
  return { items };
}

/* ── 네이버 뉴스 검색 API ── */
function stripNaverMarkup(s: string): string {
  return decodeEntities((s || "").replace(/<\/?b>/g, "")).trim();
}
export async function fetchNaverSearch(query: string, env: FetchEnv, display = 20): Promise<FetchResult> {
  if (!env.naverId || !env.naverSecret) throw new Error("NAVER_CLIENT_ID/SECRET 환경변수 없음");
  const params = new URLSearchParams({ query, display: String(display), sort: "date" });
  const res = await httpGet(`https://openapi.naver.com/v1/search/news.json?${params}`, {
    headers: { "X-Naver-Client-Id": env.naverId, "X-Naver-Client-Secret": env.naverSecret },
    timeoutMs: 10000,
  });
  if (!res.ok) throw new Error(`네이버 API HTTP ${res.status}`);
  const json = await res.json();
  const arr = Array.isArray(json.items) ? json.items : [];
  const items: RawItem[] = arr.map((it: Record<string, string>) => ({
    title: stripNaverMarkup(it.title ?? ""),
    link: it.originallink || it.link || "",
    pubDate: it.pubDate ?? "",
    description: stripNaverMarkup(it.description ?? ""),
    via: "naver",
  })).filter((it: RawItem) => it.title && it.link);
  return { items };
}

/* ── 구글 뉴스 RSS 검색 ── */
export async function fetchGoogleSearch(query: string): Promise<FetchResult> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const { items } = await fetchRss(url);
  // 구글 제목은 "제목 - 매체명" 형태 → 매체명 꼬리 제거 (중복 판정 정확도용)
  return { items: items.map((it) => ({ ...it, title: it.title.replace(/\s+-\s+[^-]{2,30}$/, ""), via: "google" })) };
}

/* ── 구글 뉴스 링크 → 언론사 원문 URL ── */
function decodeGoogleNewsArticleUrl(googleUrl: string): string | null {
  try {
    const match = googleUrl.match(/articles\/([A-Za-z0-9_=-]+)/);
    if (!match) return null;
    let b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < 5) return null;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(4));
    const urlMatch = text.match(/^https?:\/\/[^\s\x00-\x08\x0e-\x1f]+/);
    if (!urlMatch) return null;
    const cleaned = urlMatch[0].replace(/[\x00-\x1f\x7f-\x9f].*$/, "");
    return cleaned.startsWith("http") ? cleaned : null;
  } catch {
    return null;
  }
}
const GOOGLE_HEADERS = {
  "User-Agent": CHROME_UA,
  "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+000",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};
async function resolveViaBatchExecute(articleId: string): Promise<string | null> {
  try {
    const pageRes = await fetch(`https://news.google.com/articles/${articleId}`, { headers: GOOGLE_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sig || !ts) return null;
    const inner = JSON.stringify([
      "garturlreq",
      [["X", "X", ["ko", "KR"], null, null, 1, 1, "KR:ko", null, null, null, null, null, null, null, 0, 5], "ko", "KR", 1, [2, 4, 8], 1, 1, null, 0, 0, null, 0],
      articleId, Number(ts), sig,
    ]);
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { ...GOOGLE_HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // v1 버그 수정: 응답 속 `=`(=) 같은 이스케이프의 백슬래시에서 URL이 끊겨 `?idxno`로 잘리던 문제.
    // 닫는 따옴표(\",)까지 통째로 잡은 뒤 이스케이프를 풀어준다.
    const raw = text.match(/garturlres\\",\\"(https?:.+?)\\",/)?.[1];
    if (!raw) return null;
    return raw
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  } catch {
    return null;
  }
}
export async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  if (!url.includes("news.google.com")) return url;
  const decoded = decodeGoogleNewsArticleUrl(url);
  if (decoded) return decoded;
  const id = url.match(/articles\/([A-Za-z0-9_=-]+)/)?.[1];
  if (id) {
    const r = await resolveViaBatchExecute(id);
    if (r) return r;
  }
  return null; // 복원 실패 — 구글 링크 그대로는 원문을 못 읽으므로 후보에서 제외
}

/* ── 렌더링 서비스 (JS로 목록을 불러오는 사이트용) ── */
export async function fetchRendered(url: string, env: FetchEnv): Promise<string> {
  const headers: Record<string, string> = { "X-Return-Format": "html" };
  if (env.jinaKey) headers["Authorization"] = `Bearer ${env.jinaKey}`;
  const res = await httpGet(`https://r.jina.ai/${url}`, { headers, timeoutMs: 30000 }, 1);
  if (!res.ok) throw new Error(`렌더링 서비스 HTTP ${res.status}`);
  return await res.text();
}

/* ── 웹페이지 목록 ── */
function shapeOf(u: string): string {
  try {
    const x = new URL(u);
    const names = [...x.searchParams.keys()].sort().join("&");
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\d+/g, "#")}?${names}`;
  } catch { return u; }
}
export function extractListItems(html: string, baseUrl: string, cfg: ListConfig = {}): RawItem[] {
  let h = html;
  if (cfg.region?.start) {
    const s = h.indexOf(cfg.region.start);
    if (s >= 0) {
      h = h.slice(s);
      if (cfg.region.end) {
        const e = h.indexOf(cfg.region.end, cfg.region.start.length);
        if (e > 0) h = h.slice(0, e);
      }
    }
  }
  const byUrl = new Map<string, { url: string; text: string; heading: string }>();
  for (const m of h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    let href = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1, 3).find(Boolean) ?? "";
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
      // 링크가 onclick 안에 숨은 사이트 (예: fn_movePage('/board/news-detail.do?postNo=1'))
      const oc = attrs.match(/\bonclick\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1, 3).find(Boolean) ?? "";
      href = oc.match(/['"](\/[^'"\s]+)['"]/)?.[1] ?? "";
    }
    if (!href) continue;
    href = decodeEntities(href);
    let abs: string;
    try { abs = new URL(href.startsWith("//") ? "https:" + href : href, baseUrl).toString(); } catch { continue; }
    if (cfg.link_pattern && !new RegExp(cfg.link_pattern).test(abs)) continue;
    const inner = m[2];
    const text = decodeEntities(inner.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const heading = decodeEntities((inner.match(/<(h[1-6]|strong)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const prev = byUrl.get(abs);
    if (!prev || text.length > prev.text.length) byUrl.set(abs, { url: abs, text, heading: heading || prev?.heading || "" });
    else if (heading && !prev.heading) prev.heading = heading;
  }
  let entries = [...byUrl.values()];
  if (!cfg.link_pattern) {
    // 패턴 지정이 없으면 "가장 많이 반복되는 URL 모양"을 기사 링크로 간주
    const groups = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.text.length < 8 && !e.heading) continue;
      const k = shapeOf(e.url);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
    }
    const top = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    entries = top && top.length >= 2 ? top : [];
  }
  const items: RawItem[] = [];
  for (const e of entries) {
    const dm = e.text.match(/(20\d{2})[.\-](\d{1,2})[.\-](\d{1,2})(?:\s*(\d{2}:\d{2}))?/);
    const before = dm ? e.text.slice(0, dm.index).trim() : e.text;
    const title = (e.heading.length >= 6 ? e.heading : before).replace(/\s+/g, " ").slice(0, 120);
    if (title.length < 6) continue;
    const after = dm ? e.text.slice((dm.index ?? 0) + dm[0].length).replace(/^[\sI|·]*\S{2,6}\s?기자\s*/, "").trim() : "";
    const date = dm ? `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}${dm[4] ? "T" + dm[4] : ""}` : "";
    items.push({ title, link: e.url, pubDate: date, description: after.slice(0, 300) });
  }
  return items;
}
async function getListHtml(url: string, cfg: ListConfig): Promise<string> {
  const req = cfg.request;
  const headers: Record<string, string> = { "User-Agent": CHROME_UA, ...(req?.headers ?? {}) };
  let init: RequestInit & { timeoutMs?: number } = { headers };
  if (req?.method && req.method.toUpperCase() === "POST") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.form ?? {})) fd.append(k, v);
    init = { method: "POST", body: fd, headers };
  }
  const res = await httpGet(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
export async function fetchWebList(url: string, cfg: ListConfig, env: FetchEnv): Promise<FetchResult> {
  const urls = [url, ...(cfg.urls ?? [])];
  const all: RawItem[] = [];
  let mode = "direct";
  let firstError: string | undefined;
  for (const u of urls) {
    let items: RawItem[] = [];
    if (cfg.render !== true) {
      try {
        items = extractListItems(await getListHtml(u, cfg), u, cfg);
      } catch (e) {
        firstError ??= (e as Error).message;
      }
    }
    // 직접 가져오기로 0건이면(JS로 목록을 그리는 사이트) 렌더링 서비스로 한 번 더 시도
    if (items.length === 0 && cfg.render !== false) {
      try {
        items = extractListItems(await fetchRendered(u, env), u, cfg);
        if (items.length) { mode = "render"; firstError = undefined; }
      } catch (e) {
        firstError ??= (e as Error).message;
      }
    }
    all.push(...items);
  }
  const seen = new Set<string>();
  const items = all.filter((it) => (seen.has(it.link) ? false : (seen.add(it.link), true)));
  if (items.length === 0 && firstError) return { items, error: firstError, mode };
  return { items, mode };
}

/* ── JSON API (게시판 JSON 등) ── */
export async function fetchJsonList(url: string, cfg: ListConfig): Promise<FetchResult> {
  const res = await httpGet(url, { headers: { "User-Agent": CHROME_UA, "Accept": "application/json", ...(cfg.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const list = getPath(json, cfg.list_path ?? "list");
  if (!Array.isArray(list)) throw new Error(`JSON에서 목록(${cfg.list_path ?? "list"})을 찾지 못함`);
  const f = cfg.fields ?? {};
  const items: RawItem[] = [];
  for (const row of list as Record<string, unknown>[]) {
    const title = decodeEntities(String(getPath(row, f.title ?? "title") ?? "")).trim();
    const id = String(getPath(row, f.id ?? "id") ?? "");
    let link = f.link ? String(getPath(row, f.link) ?? "") : "";
    if (!link && cfg.link_template) link = cfg.link_template.replace(/\{id\}/g, id).replace(/\{(\w+)\}/g, (_m, k) => String(row[k] ?? ""));
    const bodyHtml = f.body ? String(getPath(row, f.body) ?? "") : "";
    const bodyText = bodyHtml ? extractText(decodeEntities(bodyHtml)) : "";
    const dateRaw = f.date ? String(getPath(row, f.date) ?? "") : "";
    if (!title || !link) continue;
    items.push({ title, link, pubDate: toISO(parseDateLoose(dateRaw)) ?? "", description: bodyText.slice(0, 300), bodyText: bodyText || undefined });
  }
  return { items };
}

/* ── 기사 원문 1회 fetch → 본문·이미지·발행일 ── */
export async function fetchArticleData(url: string): Promise<{ text: string; image_url: string | null; published_at: string | null; ok: boolean }> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": CHROME_UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
    const html = await res.text();
    if (!res.ok) return { text: "", image_url: null, published_at: null, ok: false };
    return { text: extractText(html), image_url: extractOgImage(html), published_at: extractPublishedDate(html), ok: true };
  } catch {
    return { text: "", image_url: null, published_at: null, ok: false };
  }
}
