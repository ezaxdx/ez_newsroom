// curate-v2 파이프라인 — "전체 목록 수집 → 후보 정리 → 원문 확보 → AI 작성 → 판정·저장" 단계형
// supabase 클라이언트와 환경변수는 외부에서 주입 (Deno Edge 함수와 Node 로컬 테스트 양쪽에서 사용)
import type { FetchEnv, FetchResult, ListConfig, RawItem } from "./fetchers.ts";
import {
  fetchArticleData, fetchGoogleSearch, fetchJsonList, fetchNaverSearch, fetchRss, fetchWebList, resolveGoogleNewsUrl,
} from "./fetchers.ts";
import {
  calcScheduledRun, checkWindow, hostOf, isSameStory, mapPool, normalizeUrl, normTitle, parseDateLoose, sleep, toISO, withTimeout,
} from "./util.ts";
import type { CatSetting } from "./ai.ts";
import { buildHintBlock, canonicalDomain, generateArticle, judgeFit } from "./ai.ts";
import { sendAlert } from "./alert.ts";

/* ───────── 타입 ───────── */
export interface RunOptions {
  dry: boolean;              // true: 기사·소스상태·건너뜀 기록을 저장하지 않음 (시험 실행)
  maxAi?: number;            // 시험 실행에서 AI 작성 건수 상한 (비용 보호)
  onlySource?: string;       // 소스명 일부 — 해당 소스만 실행
  extraSources?: Partial<Source>[];   // 시험용: DB를 바꾸지 않고 메모리에서 소스 설정을 얹어 시험 (dry 에서만)
  replaceSources?: boolean;  // true 면 DB 의 소스 대신 extraSources 만 사용
  calibrated?: boolean;      // 시험 실행에서 점수 보정 프롬프트를 강제로 켜기/끄기
  budgetMs?: number;         // 처리 시간 예산
  writeLog?: boolean;        // curation_logs 기록 여부 (기본 true)
}
export interface Deps {
  supabase: any;
  env: (key: string) => string | undefined;
  log?: (msg: string) => void;
}
interface Source {
  id: string; url: string; source_name: string; weight: number; default_category: string; is_active: boolean;
  source_type: string; keyword_filter?: boolean; keyword_mode?: string; custom_keywords?: string[];
  max_items?: number; fetch_config?: ListConfig | null; zero_streak?: number; last_alerted_at?: string | null;
}
interface PickEvent { id: string; name: string; start: string | null; end: string | null; queryTerms: string[]; matchers: RegExp[] }
interface SrcRef { key: string; name: string; type: string; weight: number; category: string; via: string; maxItems: number; keywordMode: string; customKeywords: string[]; eventId?: string }
interface Cand {
  title: string; link: string; pubDate: string; pubMs: number | null; description: string; bodyText?: string;
  urlKey: string; srcs: SrcRef[]; vias: Set<string>; event: PickEvent | null; eventSearchOnly: boolean; coverage: number;
  text?: string; image?: string | null;
}
interface Stat {
  key: string; id?: string; name: string; type: string; fetched: number; status: "ok" | "empty" | "error" | "skipped";
  error?: string; mode?: string; kept: number; published: number; staged: number; skipped: number; failed: number;
  deferred: number; reasons: Record<string, number>;
}

const ALL_CATS = ["MICE", "TOURISM", "AI"];
const FIT_DISCARD = 5;   // 적합성 4점 이하는 싣지 않음 (폐기)
const FIT_PUBLISH = 7;   // 7점 이상이어야 자동 발행 — 5~6점은 대기열에서 사람이 검토 (2026-10-06 관리자 판정 12건 기준)
const PICK_PUBLISH_SCORE = 5;        // 이즈픽 행사 기사: 품질 5점 이상이면 자동 발행, 적합성 관문 면제
const PICK_PER_EVENT = 3;            // 행사당 1회 최대 건수
const GOOGLE_RESOLVE_CAP = 40;       // 구글 링크 복원 상한 (1회 실행)
const DEFAULT_FOCUS = ["MICE", "마이스", "전시회", "박람회", "엑스포", "국제회의", "컨벤션", "관광", "스마트관광", "글로컬관광", "관광공사", "여행", "AI", "인공지능", "AX", "디지털전환", "스마트"];
const RETRY_AFTER_MS: Record<string, number> = { too_short: 3 * 86400000, fetch_failed: 3 * 86400000 }; // 일시적일 수 있는 사유는 3일 뒤 재시도

const newStat = (key: string, name: string, type: string, id?: string): Stat =>
  ({ key, id, name, type, fetched: 0, status: "empty", kept: 0, published: 0, staged: 0, skipped: 0, failed: 0, deferred: 0, reasons: {} });
const bump = (s: Stat, reason: string) => { s.reasons[reason] = (s.reasons[reason] ?? 0) + 1; s.skipped++; };

async function fetchAll(build: (from: number, to: number) => Promise<{ data: any[] | null; error: any }>, page = 1000): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

/* ───────── 이즈픽 행사 ───────── */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 행사명·별칭 → 검색어와 매칭 정규식. 영문은 단어 경계를 요구해 "MEeT"가 "Meet a Mentor"에 걸리는 오탐을 막음 */
function eventTerms(names: string[]): { queryTerms: string[]; matchers: RegExp[] } {
  const variants = new Set<string>();
  for (const n of names) {
    const raw = (n ?? "").trim();
    if (!raw) continue;
    variants.add(raw);
    // 연도 표기를 뺀 이름도 쓰되, 짧거나 영문뿐이면 일반 단어와 헷갈리므로 제외 ("MEeT 2026" → "MEeT" 는 쓰지 않음)
    const noYear = raw.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim();
    const compact = normTitle(noYear);
    const hasHangul = /[가-힣]/.test(noYear);
    if (noYear && noYear !== raw && ((hasHangul && compact.length >= 4) || compact.length >= 8)) variants.add(noYear);
  }
  const queryTerms = [...variants].filter((v) => normTitle(v).length >= 4);
  const matchers = queryTerms.map((v) => {
    const body = v.trim().split(/\s+/).map(escapeRe).join("[\\s\\-_·]*");
    const pre = /^[A-Za-z0-9]/.test(v) ? "(?<![A-Za-z0-9])" : "";
    const post = /[A-Za-z0-9]$/.test(v) ? "(?![A-Za-z0-9])" : "";
    return new RegExp(pre + body + post, "i");
  });
  return { queryTerms, matchers };
}
function eventMatches(ev: PickEvent, title: string, description: string): boolean {
  const hay = `${title} ${description.slice(0, 300)}`;
  return ev.matchers.some((re) => re.test(hay));
}

/* ───────── 메인 ───────── */
export async function runCuration(deps: Deps, opts: RunOptions) {
  const { supabase, env } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const runStart = Date.now();
  const budgetMs = opts.budgetMs ?? 120_000;
  const overBudget = () => Date.now() - runStart > budgetMs;
  const live = !opts.dry;
  const apiKey = env("GOOGLE_AI_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY 없음");
  const fenv: FetchEnv = { naverId: env("NAVER_CLIENT_ID"), naverSecret: env("NAVER_CLIENT_SECRET"), jinaKey: env("JINA_API_KEY") };
  const webhook = env("DISCORD_WEBHOOK_URL");

  /* ── 0. 준비 ── */
  let dbSources: Source[] = [];
  if (!(opts.dry && opts.replaceSources)) {
    const { data: sourcesRaw, error: srcErr } = await supabase.from("rss_sources").select("*").eq("is_active", true);
    if (srcErr) throw new Error(`rss_sources 조회 실패: ${srcErr.message}`);
    dbSources = sourcesRaw ?? [];
  }
  const extra: Source[] = opts.dry ? (opts.extraSources ?? []).map((e, i) => ({ id: `x${i}`, is_active: true, weight: 5, default_category: "MICE", ...e }) as Source) : [];
  let sources: Source[] = [...dbSources, ...extra].sort((a: Source, b: Source) => (b.weight ?? 0) - (a.weight ?? 0));
  if (opts.onlySource) sources = sources.filter((s) => s.source_name.includes(opts.onlySource!));
  if (!sources.length && !opts.onlySource) throw new Error("활성 소스 없음");

  const { data: settings } = await supabase.from("curation_settings")
    .select("category_settings, level_prompts, quality_thresholds, company_context, focus_keywords, business_domain_examples, content_quality_notes, auto_schedule, category_hints, category_examples")
    .limit(1).single();
  const schedule = settings?.auto_schedule ?? {};
  const scheduleDays: number[] = schedule.days?.length ? schedule.days : [2, 4];
  const scheduleHour: number = schedule.hour ?? 9;
  const windowEnd = calcScheduledRun(scheduleDays, scheduleHour, Date.now());
  const windowStart = calcScheduledRun(scheduleDays, scheduleHour, windowEnd - 1);
  const catSettings: Record<string, CatSetting> = settings?.category_settings ?? {};
  const levelPrompts: Record<string, Record<string, string>> = settings?.level_prompts ?? {};
  const thresholds = settings?.quality_thresholds ?? { auto_publish: 8, staging: 5 };
  // 점수 보정 프롬프트 사용 여부 — DB 설정(quality_thresholds.calibrated)으로 켜고 끔. 시험 실행은 옵션으로 덮어쓸 수 있음
  // 기본은 켜짐(적합성·레벨 기준표). quality_thresholds.calibrated 를 false 로 두면 v1 프롬프트로 되돌림
  const calibrated = opts.dry && opts.calibrated != null ? opts.calibrated : thresholds.calibrated !== false;
  // 관리자가 직접 고친 레벨 사례 — 컬럼이 아직 없어도(전환 SQL 실행 전) 실행이 깨지지 않게 별도 조회
  let levelExamples: { title: string; level: string }[] = [];
  try {
    const { data: lv, error: lvErr } = await supabase.from("curation_settings").select("level_examples").limit(1).single();
    if (!lvErr && Array.isArray(lv?.level_examples)) levelExamples = lv.level_examples;
  } catch { /* level_examples 컬럼 없음 — 사례 없이 진행 */ }
  const focusKeywords: string[] = (settings?.focus_keywords?.length ? settings.focus_keywords : DEFAULT_FOCUS).map((k: string) => k.toLowerCase());
  const domainExamples: { title: string; business_domains: string[] }[] = Array.isArray(settings?.business_domain_examples) ? settings.business_domain_examples : [];
  const qualityNotes: string[] = Array.isArray(settings?.content_quality_notes) ? settings.content_quality_notes : [];
  const catExamples: { title: string; category: string }[] = Array.isArray(settings?.category_examples) ? settings.category_examples : [];
  const companyContext =
    (settings?.company_context ?? "") +
    (domainExamples.length ? `\n\n【사업영역 분류 확정 예시 — 관리자가 직접 검수함, 비슷한 유형의 제목은 이 사례를 참고해 분류하세요】\n` + domainExamples.slice(0, 30).map((e) => `- "${e.title}" → ${JSON.stringify(e.business_domains)}`).join("\n") : "") +
    (catExamples.length ? `\n\n【카테고리 확정 예시 — 관리자가 직접 고침, 비슷한 제목은 이 사례를 참고해 카테고리를 판단하세요】\n` + catExamples.slice(0, 30).map((e) => `- "${e.title}" → ${e.category}`).join("\n") : "") +
    (qualityNotes.length ? `\n\n【콘텐츠 품질 감사에서 실제로 발견·수정된 문제 유형 — 아래와 같은 실수를 반복하지 마세요】\n` + qualityNotes.slice(0, 30).map((n) => `- ${n}`).join("\n") : "");
  const hintBlock = buildHintBlock(settings?.category_hints);
  log(`[발행 창] ${new Date(windowStart).toISOString()} ~ ${new Date(windowEnd).toISOString()}`);

  // 기존 기사·건너뛴 URL·최근 제목 (정규화해서 비교)
  const existingRows = await fetchAll((f, t) => supabase.from("news").select("original_url").range(f, t));
  const existingKeys = new Set<string>(existingRows.map((r: any) => normalizeUrl(r.original_url)));
  const seenCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const seenRows = await fetchAll((f, t) => supabase.from("curation_seen").select("url_key, reason, seen_at").gte("seen_at", seenCutoff).range(f, t));
  const seenKeys = new Set<string>();
  for (const r of seenRows) {
    const ttl = RETRY_AFTER_MS[r.reason];
    if (ttl && Date.now() - new Date(r.seen_at).getTime() > ttl) continue;
    seenKeys.add(r.url_key);
  }
  const recentRows = await fetchAll((f, t) => supabase.from("news").select("title, original_title").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()).range(f, t));
  const recentTitles: string[] = recentRows.flatMap((r: any) => [r.title, r.original_title].filter(Boolean));

  // 이즈픽(수동 ⭐) 행사 — 시작 D-30 ~ 종료 D+30 구간만
  const { data: pickRows } = await supabase.from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, news_keywords, is_published").eq("is_ezpmp_pick", true);
  const nowMs = Date.now();
  const picks: PickEvent[] = (pickRows ?? [])
    .filter((e: any) => e.is_published !== false)
    .filter((e: any) => {
      const s = e.start_date ? parseDateLoose(e.start_date) : null;
      const en = e.end_date ? parseDateLoose(e.end_date) : s;
      if (s == null) return false;
      return nowMs >= s - 30 * 86400000 && nowMs <= (en ?? s) + 31 * 86400000;
    })
    .map((e: any) => {
      const { queryTerms, matchers } = eventTerms([e.event_name, e.event_name_en, ...(e.news_keywords ?? [])]);
      return { id: e.id, name: e.event_name, start: e.start_date, end: e.end_date, queryTerms, matchers } as PickEvent;
    })
    .filter((e: PickEvent) => e.queryTerms.length > 0 && !opts.onlySource);   // 특정 소스만 시험할 땐 행사 검색 생략
  log(`[이즈픽] 검색 대상 행사 ${picks.length}개: ${picks.map((p) => p.name).join(", ")}`);

  /* ── 1. 목록 수집 (가벼움 — 소스끼리 동시 실행, 원문은 열지 않음) ── */
  const stats = new Map<string, Stat>();
  const rawCands: { item: RawItem; src: SrcRef }[] = [];
  interface Task { key: string; run: () => Promise<FetchResult>; src: SrcRef; via: string }
  const tasks: Task[] = [];
  const srcRefOf = (s: Source, via: string): SrcRef => ({
    key: `src:${s.id}`, name: s.source_name, type: s.source_type, weight: s.weight ?? 0, category: (s.default_category ?? "MICE").toUpperCase(), via,
    maxItems: s.max_items ?? 10,
    keywordMode: s.keyword_mode && s.keyword_mode !== "none" ? s.keyword_mode : (s.keyword_filter ? "default" : "none"),
    customKeywords: (s.custom_keywords ?? []).map((k) => k.toLowerCase()),
  });
  for (const s of sources) {
    const key = `src:${s.id}`;
    const cfg = (s.fetch_config ?? {}) as ListConfig;
    stats.set(key, newStat(key, s.source_name, s.source_type, s.id));
    const t = s.source_type;
    if (t === "keyword_search" || t === "naver_news") {
      const engines = t === "naver_news" ? ["naver"] : (cfg.engines?.length ? cfg.engines : ["naver"]);
      if (engines.includes("naver")) tasks.push({ key, via: "naver", src: srcRefOf(s, "naver"), run: () => fetchNaverSearch(s.url, fenv, 20) });
      if (engines.includes("google")) tasks.push({ key, via: "google", src: srcRefOf(s, "google"), run: () => fetchGoogleSearch(s.url) });
    } else if (t === "rss") {
      const via = s.url.includes("news.google.com") ? "google" : `rss:${s.source_name}`;
      tasks.push({ key, via, src: srcRefOf(s, via), run: () => fetchRss(s.url) });
    } else if (t === "web_list" || t === "url") {
      const via = `web:${s.source_name}`;
      tasks.push({ key, via, src: srcRefOf(s, via), run: () => fetchWebList(s.url, cfg, fenv) });
    } else if (t === "json_list") {
      const via = `api:${s.source_name}`;
      tasks.push({ key, via, src: srcRefOf(s, via), run: () => fetchJsonList(s.url, cfg) });
    } else {
      const st = stats.get(key)!;
      st.status = "skipped"; st.error = `지원하지 않는 방식(${t})`;
    }
  }
  // 이즈픽 행사 검색 — 행사명·별칭을 네이버·구글에서 검색
  for (const ev of picks) {
    const key = `event:${ev.id}`;
    stats.set(key, newStat(key, `행사: ${ev.name}`, "event_search"));
    for (const term of ev.queryTerms.slice(0, 3)) {
      const ref: SrcRef = { key, name: `행사: ${ev.name}`, type: "event_search", weight: 10, category: "MICE", via: "event", maxItems: PICK_PER_EVENT, keywordMode: "none", customKeywords: [], eventId: ev.id };
      tasks.push({ key, via: "naver", src: ref, run: () => fetchNaverSearch(term, fenv, 20) });
      tasks.push({ key, via: "google", src: ref, run: () => fetchGoogleSearch(term) });
    }
  }
  const taskResults = await mapPool(tasks, 6, async (t) => {
    try {
      const r = await withTimeout(t.run(), 40000, "목록 수집");
      return { t, r };
    } catch (e) {
      return { t, r: { items: [], error: (e as Error).message } as FetchResult };
    }
  });
  const errorsBySource = new Map<string, string[]>();
  for (const { t, r } of taskResults) {
    const st = stats.get(t.key)!;
    if (r.error) (errorsBySource.get(t.key) ?? errorsBySource.set(t.key, []).get(t.key)!).push(`${t.via}: ${r.error}`);
    if (r.mode) st.mode = r.mode;
    st.fetched += r.items.length;
    for (const item of r.items) rawCands.push({ item: { ...item, via: t.via }, src: t.src });
  }
  for (const [key, st] of stats) {
    if (st.status === "skipped") continue;
    const errs = errorsBySource.get(key);
    const taskCount = tasks.filter((t) => t.key === key).length;
    if (errs && (st.fetched === 0 || errs.length === taskCount)) { st.status = "error"; st.error = errs.join(" / "); }
    else st.status = st.fetched > 0 ? "ok" : "empty";
    if (errs && st.status === "ok") st.error = errs.join(" / "); // 일부 엔진만 실패 — 기록은 남김
  }
  const funnel: Record<string, number> = { raw: rawCands.length };
  log(`[1단계] 후보 ${rawCands.length}건 수집 (${Date.now() - runStart}ms)`);

  /* ── 2. 후보 정리 (구글 URL 복원 말고는 네트워크 안 씀) ── */
  // a) 발행 창 — 날짜를 아는 후보는 원문을 열기 전에 거름
  const inWindow: { item: RawItem; src: SrcRef; pubMs: number | null }[] = [];
  for (const rc of rawCands) {
    const st = stats.get(rc.src.key)!;
    const pubMs = parseDateLoose(rc.item.pubDate);
    const v = checkWindow(pubMs, windowStart, windowEnd);
    if (v === "too_old") { bump(st, "too_old"); continue; }
    if (v === "too_new") { bump(st, "too_new"); continue; }
    inWindow.push({ ...rc, pubMs });
  }
  funnel.afterWindow = inWindow.length;

  // b) 구글 링크 → 원문 URL 복원 (상한 적용, 최신순)
  // b0) 구글 후보는 복원하기 전에 제목으로 먼저 거름 — 네이버 등이 이미 잡은 기사, 이미 등록된 기사, 구글끼리 중복인 기사는
  //     원문 URL을 복원할 필요가 없음 (복원은 구글에 요청을 보내는 일이라 횟수를 줄일수록 안정적)
  const isGoogle = (l: string) => l.includes("news.google.com");
  const extraVias = new Map<number, Set<string>>();
  const dropped = new Set<number>();
  const nonGoogle = inWindow.map((c, i) => ({ c, i })).filter(({ c }) => !isGoogle(c.item.link));
  const googleOrdered = inWindow.map((c, i) => ({ c, i })).filter(({ c }) => isGoogle(c.item.link))
    .sort((a, b) => (Number(!!b.c.src.eventId) - Number(!!a.c.src.eventId)) || (b.c.src.weight - a.c.src.weight) || ((b.c.pubMs ?? 0) - (a.c.pubMs ?? 0)));
  const keptGoogleTitles: string[] = [];
  for (const { c, i } of googleOrdered) {
    const st = stats.get(c.src.key)!;
    const t = c.item.title;
    const hit = nonGoogle.find((x) => isSameStory(t, x.c.item.title));
    if (hit) { (extraVias.get(hit.i) ?? extraVias.set(hit.i, new Set()).get(hit.i)!).add("google"); dropped.add(i); bump(st, "dup_pre_resolve"); continue; }
    if (recentTitles.some((rt) => isSameStory(t, rt))) { dropped.add(i); bump(st, "dup_published"); continue; }
    if (keptGoogleTitles.some((kt) => isSameStory(t, kt))) { dropped.add(i); bump(st, "dup_pre_resolve"); continue; }
    keptGoogleTitles.push(t);
  }

  // 같은 구글 링크는 한 번만 복원 (행사 검색어끼리 결과가 많이 겹침). 이즈픽 후보 → 중요도 → 최신순으로 우선 복원
  const googleLinks = new Map<string, number>();
  inWindow.forEach((c, i) => {
    if (!isGoogle(c.item.link) || dropped.has(i)) return;
    const score = (c.src.eventId ? 1e12 : 0) + c.src.weight * 1e9 + (c.pubMs ?? 0) / 1e3;
    googleLinks.set(c.item.link, Math.max(googleLinks.get(c.item.link) ?? 0, score));
  });
  const toResolve = [...googleLinks.entries()].sort((a, b) => b[1] - a[1]).slice(0, GOOGLE_RESOLVE_CAP).map(([l]) => l);
  const resolvedByLink = new Map<string, string | null>();
  await mapPool(toResolve, 4, async (link) => {
    let r = await resolveGoogleNewsUrl(link);
    if (!r) { await sleep(700); r = await resolveGoogleNewsUrl(link); }   // 구글이 일시적으로 제한할 수 있어 1회 재시도
    resolvedByLink.set(link, r);
  });
  const resolved: { item: RawItem; src: SrcRef; pubMs: number | null; link: string; extra?: Set<string> }[] = [];
  inWindow.forEach((c, i) => {
    if (dropped.has(i)) return;
    const st = stats.get(c.src.key)!;
    if (isGoogle(c.item.link)) {
      if (!resolvedByLink.has(c.item.link)) { bump(st, "over_cap"); return; }
      const l = resolvedByLink.get(c.item.link);
      if (!l) { bump(st, "unresolved"); return; }
      resolved.push({ ...c, link: l });
    } else resolved.push({ ...c, link: c.item.link, extra: extraVias.get(i) });
  });
  funnel.afterResolve = resolved.length;

  // c) 이미 등록된/건너뛴 URL 제외
  const fresh: typeof resolved = [];
  for (const c of resolved) {
    const st = stats.get(c.src.key)!;
    const key = normalizeUrl(c.link);
    if (!key) { bump(st, "bad_url"); continue; }
    if (existingKeys.has(key)) { bump(st, "exists"); continue; }
    if (seenKeys.has(key)) { bump(st, "seen"); continue; }
    fresh.push(c);
  }
  funnel.afterExists = fresh.length;

  // d) 가져올 기사 필터 + 이즈픽 행사 검색 결과의 엄격 매칭
  const eventById = new Map(picks.map((p) => [p.id, p]));
  const passed: typeof fresh = [];
  for (const c of fresh) {
    const st = stats.get(c.src.key)!;
    const title = c.item.title.toLowerCase();
    if (c.src.eventId) {
      const ev = eventById.get(c.src.eventId)!;
      if (!eventMatches(ev, c.item.title, c.item.description)) { bump(st, "event_mismatch"); continue; }
    } else if (c.src.keywordMode === "default") {
      if (!focusKeywords.some((k) => title.includes(k))) { bump(st, "off_topic"); continue; }
    } else if (c.src.keywordMode === "custom") {
      if (!c.src.customKeywords.some((k) => title.includes(k))) { bump(st, "off_topic"); continue; }
    }
    passed.push(c);
  }
  funnel.afterFilter = passed.length;

  // e) 같은 URL 병합 (네이버·구글 동시 수집 등) — 발견 경로는 모두 기록
  const merged = new Map<string, Cand>();
  for (const c of passed) {
    const urlKey = normalizeUrl(c.link);
    const prev = merged.get(urlKey);
    if (!prev) {
      merged.set(urlKey, {
        title: c.item.title, link: c.link, pubDate: toISO(c.pubMs) ?? c.item.pubDate, pubMs: c.pubMs, description: c.item.description,
        bodyText: c.item.bodyText, urlKey, srcs: [c.src], vias: new Set([c.item.via ?? c.src.via, ...(c.extra ?? [])]), event: null,
        eventSearchOnly: !!c.src.eventId, coverage: 1,
      });
    } else {
      prev.srcs.push(c.src);
      prev.vias.add(c.item.via ?? c.src.via);
      for (const v of c.extra ?? []) prev.vias.add(v);
      if (!c.src.eventId) prev.eventSearchOnly = false;
      // 네이버 쪽 정보를 우선 (발행일·요약이 항상 있음)
      if ((c.item.via === "naver") && c.item.description) { prev.description = c.item.description; if (c.pubMs) { prev.pubMs = c.pubMs; prev.pubDate = toISO(c.pubMs) ?? prev.pubDate; } }
      if (c.item.bodyText && !prev.bodyText) prev.bodyText = c.item.bodyText;
      const stDup = stats.get(c.src.key)!; stDup.reasons["merged_same_url"] = (stDup.reasons["merged_same_url"] ?? 0) + 1;
    }
  }
  let cands = [...merged.values()];
  funnel.afterMerge = cands.length;

  // f) 이즈픽 행사 매칭 — 어느 경로로 왔든 제목·본문 앞부분에 행사명이 있으면 이즈픽 기사
  for (const c of cands) {
    c.event = picks.find((ev) => eventMatches(ev, c.title, c.description)) ?? null;
  }
  // 행사 검색에서만 걸렸는데 정작 매칭이 안 된 건 위 d)에서 이미 제거됨

  // g) 제목 유사도 — 최근 7일 등록 기사와 비교, 같은 실행 안에서는 묶어서 대표 1건만
  const afterDb: Cand[] = [];
  for (const c of cands) {
    const dup = recentTitles.some((t) => isSameStory(c.title, t));
    if (dup) { for (const s of c.srcs) bump(stats.get(s.key)!, "dup_published"); continue; }
    afterDb.push(c);
  }
  const parent = afterDb.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < afterDb.length; i++) for (let j = i + 1; j < afterDb.length; j++) {
    if (isSameStory(afterDb[i].title, afterDb[j].title)) parent[find(j)] = find(i);
  }
  const clusters = new Map<number, Cand[]>();
  afterDb.forEach((c, i) => (clusters.get(find(i)) ?? clusters.set(find(i), []).get(find(i))!).push(c));
  const reps: Cand[] = [];
  for (const group of clusters.values()) {
    // 대표: 이즈픽 > 지정 소스(검색 아님) > 본문 긴 것 > 먼저 발행된 것
    const score = (c: Cand) => (c.event ? 1e9 : 0) + (c.srcs.some((s) => s.type !== "keyword_search" && s.type !== "naver_news" && s.type !== "event_search") ? 1e6 : 0) + (c.bodyText?.length ?? c.description.length);
    group.sort((a, b) => score(b) - score(a) || (a.pubMs ?? 9e15) - (b.pubMs ?? 9e15));
    const rep = group[0];
    const hosts = new Set(group.map((c) => hostOf(c.urlKey)));
    rep.coverage = hosts.size;
    for (const o of group.slice(1)) {
      for (const s of o.srcs) bump(stats.get(s.key)!, "dup_cluster");
      for (const v of o.vias) rep.vias.add(v);
      for (const s of o.srcs) if (!rep.srcs.some((x) => x.key === s.key)) rep.srcs.push(s);
    }
    reps.push(rep);
  }
  funnel.afterDedup = reps.length;

  // h) 우선순위 정렬 + 소스별·행사별 상한
  const primaryOf = (c: Cand) => [...c.srcs].sort((a, b) => b.weight - a.weight)[0];
  reps.sort((a, b) => (Number(!!b.event) - Number(!!a.event)) || (primaryOf(b).weight - primaryOf(a).weight) || ((b.pubMs ?? 0) - (a.pubMs ?? 0)));
  const perSource = new Map<string, number>();
  const perEvent = new Map<string, number>();
  const selected: Cand[] = [];
  for (const c of reps) {
    const p = primaryOf(c);
    if (c.event) {
      const n = perEvent.get(c.event.id) ?? 0;
      if (n >= PICK_PER_EVENT) { bump(stats.get(p.key)!, "over_cap"); continue; }
      perEvent.set(c.event.id, n + 1);
    } else {
      const n = perSource.get(p.key) ?? 0;
      if (n >= p.maxItems) { bump(stats.get(p.key)!, "over_cap"); continue; }
      perSource.set(p.key, n + 1);
    }
    stats.get(p.key)!.kept++;
    selected.push(c);
  }
  funnel.selected = selected.length;
  log(`[2단계] 후보 정리 완료 — 선정 ${selected.length}건 (${Date.now() - runStart}ms)`);

  /* ── 3. 원문 확보 (선정된 기사만) ── */
  const seenOut: { url_key: string; original_url: string; reason: string; source_name: string; title: string }[] = [];
  const markSeen = (c: Cand, reason: string) => seenOut.push({ url_key: c.urlKey, original_url: c.link, reason, source_name: primaryOf(c).name, title: c.title.slice(0, 200) });
  const readyList: Cand[] = [];
  const decisions: any[] = [];
  await mapPool(selected, 5, async (c) => {
    const p = primaryOf(c); const st = stats.get(p.key)!;
    if (overBudget()) { st.deferred++; return; }
    let scraped = { text: "", image_url: null as string | null, published_at: null as string | null, ok: true };
    if (c.bodyText) scraped = { text: c.bodyText, image_url: null, published_at: null, ok: true };
    else scraped = await fetchArticleData(c.link);
    // 날짜를 목록에서 못 읽었으면 원문 메타에서 읽어 발행 창을 다시 확인
    if (c.pubMs == null && scraped.published_at) {
      c.pubMs = parseDateLoose(scraped.published_at);
      c.pubDate = toISO(c.pubMs) ?? c.pubDate;
      const v = checkWindow(c.pubMs, windowStart, windowEnd);
      if (v === "too_old") { bump(st, "too_old"); markSeen(c, "too_old"); return; }
      if (v === "too_new") { bump(st, "too_new"); return; }
    }
    const text = scraped.text.length >= 200 ? scraped.text : (c.description.length > scraped.text.length ? c.description : scraped.text);
    if (text.length < 200) {
      bump(st, scraped.ok ? "too_short" : "fetch_failed");
      markSeen(c, scraped.ok ? "too_short" : "fetch_failed");
      return;
    }
    c.text = text; c.image = scraped.image_url;
    readyList.push(c);
  });
  // 병렬 처리라 순서가 흐트러지므로 다시 우선순위 순으로
  readyList.sort((a, b) => selected.indexOf(a) - selected.indexOf(b));
  funnel.withText = readyList.length;
  log(`[3단계] 원문 확보 ${readyList.length}건 (${Date.now() - runStart}ms)`);

  /* ── 4~5. AI 작성 + 판정·저장 (이즈픽 먼저 — 정렬 이미 반영) ── */
  const results = { published: 0, staged: 0, skipped: 0, failed: 0 };
  const scoreDist: Record<string, number> = {};
  const runErrors: { source: string; url?: string; error: string }[] = [];
  const categoriesFor = (c: Cand): string[] => {
    if (c.event) return ["MICE"];
    const cats = [...new Set(c.srcs.map((s) => s.category))];
    const real = cats.filter((x) => x !== "MIXED");
    if (cats.includes("MIXED")) return [...new Set([...ALL_CATS, ...real])];
    return real.length ? real : ["MICE"];
  };
  const maxAutoPublish: number = Number.isFinite(Number(thresholds.max_auto_publish)) && Number(thresholds.max_auto_publish) > 0 ? Number(thresholds.max_auto_publish) : 20;
  let autoPublished = 0;
  let cappedCount = 0;
  const aiTargets = opts.dry && opts.maxAi != null ? readyList.slice(0, opts.maxAi) : readyList;
  let aiCalls = 0;
  // 4a. 적합성 판정 — 짧은 호출이라 한꺼번에(동시 8건). 싣지 않을 기사는 여기서 걸러 글 작성(가장 오래 걸리는 호출)을 건너뜀.
  // 작성 호출은 회사 소개(시스템 지침)가 "사업과 연결해서 분석하라"고 시켜서 어떤 기사든 연결된다고 합리화해 후하게 줌 → 판정을 분리
  const judgedMap = new Map<Cand, { fit: number; reason: string }>();
  const writeTargets: Cand[] = [];
  await mapPool(aiTargets, 8, async (c) => {
    const p = primaryOf(c); const st = stats.get(p.key)!;
    if (overBudget()) { st.deferred++; return; }
    const cats = categoriesFor(c);
    if (c.event) {
      judgedMap.set(c, { fit: 10, reason: `이즈픽 행사(${c.event.name}) 관련 기사 — 적합성 관문 면제` });
      writeTargets.push(c); return;
    }
    if (!calibrated) { writeTargets.push(c); return; }   // v1 프롬프트 모드: 작성 호출의 fit 을 그대로 씀
    const j = await judgeFit({ apiKey, title: c.title, text: c.text!, category: cats.join("/") });
    if (!j.ok) { results.failed++; st.failed++; runErrors.push({ source: p.name, url: c.link, error: `적합성 판정 실패: ${j.error}` }); return; }
    judgedMap.set(c, { fit: j.fit, reason: j.reason });
    if (j.fit < FIT_DISCARD) {
      decisions.push({ title: c.title, original_title: c.title, link: c.link, category: cats.join("/"), cats, score: null, fit: j.fit, fit_reason: j.reason, level: null, decision: "discard_fit", pre_write: true, capped: false, pick: null, vias: [...c.vias], coverage: c.coverage, source: p.name });
      results.skipped++; st.skipped++; st.reasons["low_fit"] = (st.reasons["low_fit"] ?? 0) + 1;
      markSeen(c, "low_fit");
      return;
    }
    writeTargets.push(c);
  });
  // 처리 순서: 이즈픽 먼저 → 적합성 높은 순(AI 1순위·MICE·관광 > AI 2순위 > …) → 기존 우선순위.
  // 자동 발행 상한(20건)에 걸릴 때 적합성 높은 기사가 먼저 발행되고 낮은 기사가 대기열로 가게 됨
  writeTargets.sort((a, b) =>
    (Number(!!b.event) - Number(!!a.event)) ||
    ((judgedMap.get(b)?.fit ?? 0) - (judgedMap.get(a)?.fit ?? 0)) ||
    (readyList.indexOf(a) - readyList.indexOf(b)));
  log(`[4a단계] 적합성 판정 완료 — 작성 대상 ${writeTargets.length}건 (${Date.now() - runStart}ms)`);

  // 4b. 글 작성 + 판정·저장 (동시 5건)
  await mapPool(writeTargets, 5, async (c) => {
    const p = primaryOf(c); const st = stats.get(p.key)!;
    if (overBudget()) { st.deferred++; return; }
    aiCalls++;
    const cats = categoriesFor(c);
    const jf = judgedMap.get(c);
    const judgedFit: number | null = jf?.fit ?? null;
    const judgedReason: string | null = jf?.reason ?? null;
    const gen = await generateArticle({
      apiKey, articleText: c.text!, url: c.link, categories: cats, catSettings, levelPrompts, companyContext,
      hintBlock: cats.length > 1 ? hintBlock : undefined, eventName: c.event?.name, calibrated, levelExamples,
    });
    if (!gen.ok) { results.failed++; st.failed++; runErrors.push({ source: p.name, url: c.link, error: `generateArticle 실패: ${gen.error}` }); return; }
    const g = gen.value;
    const score = g.quality_score ?? 5;
    const fit = judgedFit ?? g.quality_criteria?.fit ?? 5;
    const qualityCriteria = g.quality_criteria ? { ...g.quality_criteria, fit } : null;   // 저장하는 fit 은 판정 호출의 값
    scoreDist[score] = (scoreDist[score] ?? 0) + 1;
    const isPick = !!c.event;
    let decision: "publish" | "stage" | "discard_score" | "discard_fit";
    if (isPick) decision = score >= PICK_PUBLISH_SCORE ? "publish" : "stage";   // 적합성 관문 면제
    else if (score < (thresholds.staging ?? 5)) decision = "discard_score";
    else if (fit < FIT_DISCARD) decision = "discard_fit";
    else decision = score >= (thresholds.auto_publish ?? 8) && fit >= FIT_PUBLISH ? "publish" : "stage";
    // 한 번에 자동 발행하는 건수 상한 — 초과분은 대기열로 (이즈픽 행사 기사는 제외).
    // AI 점수가 거의 8점대로 몰려 품질 관문이 걸러내지 못하는 동안, 소스 전체가 매번 돌면서 발행량이 갑자기 늘지 않게 하는 안전장치
    let capped = false;
    if (decision === "publish" && !isPick) {
      if (autoPublished >= maxAutoPublish) { decision = "stage"; capped = true; cappedCount++; }
      else autoPublished++;
    }
    decisions.push({ title: g.title, original_title: c.title, link: c.link, category: g.category, category_reason: g.category_reason, cats, score, fit, fit_reason: judgedReason ?? g.fit_reason ?? null, level: g.level, level_axes: g.level_axes ?? null, decision, capped, pick: c.event?.name ?? null, vias: [...c.vias], coverage: c.coverage, source: p.name });
    if (decision === "discard_score" || decision === "discard_fit") {
      results.skipped++; st.skipped++; st.reasons[decision === "discard_score" ? "low_score" : "low_fit"] = (st.reasons[decision === "discard_score" ? "low_score" : "low_fit"] ?? 0) + 1;
      markSeen(c, decision === "discard_score" ? "low_score" : "low_fit");
      return;
    }
    if (!live) { if (decision === "publish") { results.published++; st.published++; } else { results.staged++; st.staged++; } return; }
    const publish = decision === "publish";
    const priority = p.weight * 10 + Math.min(15, (c.coverage - 1) * 5) + (isPick ? 30 : 0);
    const { data: ins, error } = await supabase.from("news").upsert({
      title: g.title, summary_short: g.summary_short, content_long: g.content_long, implications: g.implications,
      level: g.level ?? "Intermediate",
      image_url: c.image ?? categoryDefaultImage(g.category),
      original_url: c.link, category: g.category, quality_score: score, quality_criteria: qualityCriteria,
      // 사업영역은 발행 후에 별도 작업(classifyPending)이 판정해서 채움 — 큐레이션(발행)을 기다리게 하지 않음.
      // v1 프롬프트 모드(calibrated=false)에서만 작성 호출이 낸 값을 쓰며, 그때도 화면 집계와 같은 기준 이름으로 통일
      business_domains: calibrated ? [] : [...new Set((g.business_domains ?? []).map((d) => canonicalDomain(d)).filter((d): d is string => !!d))],
      is_published: publish,
      // 표시 순서(홈 히어로·큐레이션 보드 탑뉴스·뉴스레터 카테고리별 상위 2건이 이 값으로 정렬) — 적합성(fit)이 1순위, 품질점수는 동점 처리, 이즈픽 기사는 가산.
      // 예전엔 품질점수만 반영했는데 8~9점에 99%가 몰려 사실상 동점이라 적합성·AI 우선순위가 순서에 안 드러났음
      priority_score: priority, display_order: Math.round(1000 - (fit * 10 + score + (isPick ? 20 : 0))),
      published_at: publish ? new Date().toISOString() : (toISO(c.pubMs) ?? new Date().toISOString()),
      original_title: c.title.slice(0, 300), found_via: [...c.vias], coverage_count: c.coverage,
      related_event_id: c.event?.id ?? null, category_reason: g.category_reason, category_edited: false,
      fit_reason: (judgedReason ?? g.fit_reason ?? null)?.toString().slice(0, 200) ?? null,
    }, { onConflict: "original_url", ignoreDuplicates: true }).select("id");
    if (error) { results.failed++; st.failed++; runErrors.push({ source: p.name, url: c.link, error: error.message }); return; }
    const newId = ins?.[0]?.id;
    if (newId) await supabase.from("news_original_text").upsert({ news_id: newId, original_text: c.text });
    if (publish) { results.published++; st.published++; } else { results.staged++; st.staged++; }
  });
  log(`[4~5단계] AI ${aiCalls}건 처리 — 발행 ${results.published} 대기 ${results.staged} 폐기 ${results.skipped} 실패 ${results.failed} (${Date.now() - runStart}ms)`);

  /* ── 6. 마무리: 소스 상태·건너뜀 기록·정리·로그·알림 ── */
  const budgetExceeded = overBudget();
  const deferredTotal = [...stats.values()].reduce((s, x) => s + x.deferred, 0);
  const alerts: { title: string; description: string; level: "error" | "warning"; fields?: { name: string; value: string }[] }[] = [];

  if (live) {
    // 건너뛴·폐기한 URL 기록 (재처리 방지)
    if (seenOut.length) {
      const dedup = [...new Map(seenOut.map((r) => [r.url_key, r])).values()];
      const { error } = await supabase.from("curation_seen").upsert(dedup.map((r) => ({ ...r, seen_at: new Date().toISOString() })), { onConflict: "url_key" });
      if (error) console.error("[curation_seen upsert 실패]", error.message);
    }
    // 소스별 최근 수집 상태 + 경고 판정
    const dayAgo = Date.now() - 20 * 3600000;
    await mapPool(sources, 5, async (s) => {
      const st = stats.get(`src:${s.id}`)!;
      if (st.status === "skipped") return;
      const zeroStreak = st.fetched > 0 ? 0 : (s.zero_streak ?? 0) + 1;
      const alertedRecently = s.last_alerted_at ? new Date(s.last_alerted_at).getTime() > dayAgo : false;
      let alerted = false;
      if (!opts.onlySource) {
        if (st.status === "error" && !alertedRecently) { alerts.push({ title: `수집 소스 응답 오류 — ${s.source_name}`, description: st.error ?? "응답 오류", level: "error", fields: [{ name: "주소", value: s.url }] }); alerted = true; }
        else if (st.status === "empty" && zeroStreak >= 3 && !alertedRecently) { alerts.push({ title: `수집 소스 ${zeroStreak}회 연속 0건 — ${s.source_name}`, description: "응답은 정상인데 기사가 한 건도 안 잡힙니다. 주소·구조 변경 여부를 확인하세요.", level: "warning", fields: [{ name: "주소", value: s.url }] }); alerted = true; }
      }
      await supabase.from("rss_sources").update({
        last_run_at: new Date().toISOString(), last_status: st.status, last_fetched: st.fetched, zero_streak: zeroStreak,
        last_error: st.error ?? null, ...(alerted ? { last_alerted_at: new Date().toISOString() } : {}),
      }).eq("id", s.id);
    });
    // 오래된 대기열(30일 이상 미발행) 정리 — v1과 동일 (created_at 기준, 상한 200)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: cleanup } = await supabase.from("news").select("id, title, created_at").eq("is_published", false).lt("created_at", cutoff).limit(200);
    if (cleanup?.length) {
      console.log(`[대기열 정리] 삭제 대상 ${cleanup.length}건:`, cleanup.map((t: any) => `${t.id}(${t.created_at}) ${t.title}`).join(" | "));
      await supabase.from("news").delete().in("id", cleanup.map((t: any) => t.id));
    }
    await supabase.from("curation_seen").delete().lt("seen_at", seenCutoff);

    if (cappedCount > 0) alerts.push({ title: "자동 발행 상한 초과분을 대기열로 보냄", description: `이번 실행에서 자동 발행 상한(${maxAutoPublish}건)을 넘은 ${cappedCount}건은 대기열에 있습니다. 큐레이션 보드의 대기열에서 검토 후 발행하세요.`, level: "warning" });
    if (deferredTotal > 0) alerts.push({ title: "시간 초과로 처리 못 한 후보가 남음", description: `시간 예산을 다 써서 ${deferredTotal}건이 다음 실행으로 넘어갔습니다. (다음 실행에서 다시 후보가 됩니다)`, level: "warning" });
    if (results.failed >= 3) alerts.push({ title: "큐레이션 개별 기사 생성 실패 다수", description: `이번 실행에서 ${results.failed}건 실패(발행 ${results.published}, 대기 ${results.staged}).`, level: "warning", fields: runErrors.slice(0, 5).map((e) => ({ name: e.source, value: e.error.slice(0, 200) })) });

    // 이즈픽 행사: 시작 7일 이내인데 관련 기사가 한 건도 없으면 경고
    const soon = (pickRows ?? []).filter((e: any) => {
      const s = e.start_date ? parseDateLoose(e.start_date) : null;
      return s != null && s >= nowMs - 86400000 && s <= nowMs + 7 * 86400000 && e.is_published !== false;
    });
    const noNews: string[] = [];
    for (const e of soon) {
      const { count } = await supabase.from("news").select("id", { count: "exact", head: true }).eq("related_event_id", e.id);
      if (!count) noNews.push(`${e.event_name} (${e.start_date})`);
    }
    if (noNews.length) alerts.push({ title: "이즈픽 행사 관련 기사 없음 (시작 D-7 이내)", description: noNews.join("\n"), level: "warning" });
  }

  const durationMs = Date.now() - runStart;
  const sourceStats = [...stats.values()].map((s) => ({ name: s.name, type: s.type, fetched: s.fetched, published: s.published, staged: s.staged, skipped: s.skipped, failed: s.failed, status: s.status, error: s.error ?? null, mode: s.mode ?? null, kept: s.kept, deferred: s.deferred, reasons: s.reasons }));
  const logErrors = [...runErrors, ...sourceStats.filter((s) => s.status === "error").map((s) => ({ source: s.name, error: s.error ?? "수집 오류" })), ...(budgetExceeded ? [{ source: "(시스템)", error: "시간예산 초과로 일부 후보를 다음 실행으로 넘김" }] : [])];
  const fetched = [...stats.values()].reduce((s, x) => s + x.fetched, 0);
  const details = {
    window: { start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() },
    funnel, picks: picks.map((p) => ({ name: p.name, terms: p.queryTerms })), decisions,
    selected: selected.map((c) => ({ title: c.title, source: primaryOf(c).name, vias: [...c.vias], pick: c.event?.name ?? null, cats: categoriesFor(c), coverage: c.coverage, hasText: !!c.text })),
  };
  if (opts.writeLog !== false) {
    const { error: logError } = await supabase.from("curation_logs").insert({
      duration_ms: durationMs, fetched, published: results.published, staged: results.staged, skipped: [...stats.values()].reduce((s, x) => s + x.skipped, 0),
      failed: results.failed, score_dist: scoreDist, source_stats: sourceStats, errors: logErrors, run_mode: live ? "live" : "dry", details,
    });
    if (logError) console.error("[curation_logs insert 실패]", logError.message);
  }
  if (live) for (const a of alerts) await sendAlert(webhook, a);

  return { ok: true, mode: live ? "live" : "dry", ...results, capped: cappedCount, fetched, duration_ms: durationMs, budget_exceeded: budgetExceeded, deferred: deferredTotal, funnel, alerts: alerts.map((a) => `${a.level}: ${a.title}`), sources: sourceStats, decisions, selected: details.selected };
}

function categoryDefaultImage(category: string): string {
  const map: Record<string, string> = {
    AI: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&fit=crop&q=80",
    MICE: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&fit=crop&q=80",
    TOURISM: "https://images.unsplash.com/photo-1539635278303-d4002c07eae3?w=800&fit=crop&q=80",
  };
  return map[(category ?? "").toUpperCase()] ?? "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&fit=crop&q=80";
}
