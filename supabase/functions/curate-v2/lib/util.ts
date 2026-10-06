// curate-v2 공용 유틸 — 순수 함수 위주 (Deno/Node 양쪽에서 동작해야 하므로 런타임 전역 사용 금지)

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/* ── HTML 엔티티 ── */
export function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/* ── URL 정규화 — 같은 기사의 표기 차이(http/https, m., amp, 추적 파라미터)를 지움 ── */
const TRACKING_PARAM = /^(utm_|fbclid|gclid|mc_|ncid|spm|share|fromrss|trackingcode)/i;
export function normalizeUrl(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) s = "https:" + s;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
    const path = u.pathname.replace(/\/amp\/?$/i, "").replace(/\/+$/, "");
    return `${host}${path}${qs ? "?" + qs : ""}`;
  } catch {
    return s.toLowerCase();
  }
}
export function hostOf(urlKey: string): string {
  return urlKey.split("/")[0] ?? urlKey;
}

/* ── 제목 유사도 (한국어는 2글자 단위 bigram + Dice 계수가 잘 맞음) ── */
export function normTitle(s: string): string {
  return decodeEntities(s || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, " ") // [포토] (종합) 같은 말머리 제거
    .replace(/[^0-9a-z가-힣]+/g, "");
}
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
export function dice(a: string, b: string): number {
  if (a.length < 4 || b.length < 4) return a && a === b ? 1 : 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}
/** 제목에서 고유명사 후보(3글자 이상 단어) 추출 */
export function titleTokens(s: string): string[] {
  const cleaned = decodeEntities(s || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^0-9A-Za-z가-힣 ]+/g, " ");
  return [...new Set(cleaned.split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3))];
}
/** 같은 기사로 볼지 판정: 0.6 이상 / 0.4~0.6은 고유명사가 3개 이상 겹칠 때 */
export function isSameStory(titleA: string, titleB: string): boolean {
  const na = normTitle(titleA), nb = normTitle(titleB);
  if (!na || !nb) return false;
  const sim = dice(na, nb);
  if (sim >= 0.6) return true;
  if (sim >= 0.4) {
    const shared = titleTokens(titleA).filter((t) => nb.includes(t.replace(/[^0-9a-z가-힣]/g, "")));
    return shared.length >= 3;
  }
  return false;
}

/* ── 날짜 ── */
/** 여러 형식의 날짜 문자열 → epoch ms. 시간대 표기가 없으면 한국시간(KST)으로 간주 */
export function parseDateLoose(raw?: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const p2 = (x?: string) => (x ?? "0").padStart(2, "0");
    let tz = "+09:00";
    if (m[7]) tz = m[7] === "Z" ? "Z" : m[7].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    const t = Date.parse(`${m[1]}-${p2(m[2])}-${p2(m[3])}T${p2(m[4])}:${p2(m[5])}:${p2(m[6])}${tz}`);
    return isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
export function toISO(t: number | null): string | undefined {
  return t == null ? undefined : new Date(t).toISOString();
}
export type WindowVerdict = "in" | "too_old" | "too_new" | "unknown";
export function checkWindow(t: number | null, start: number, end: number): WindowVerdict {
  if (t == null) return "unknown";
  if (t < start) return "too_old";
  if (t > end) return "too_new";
  return "in";
}
/** 화/목(설정된 요일) 9시 스케줄 기준 직전 실행 시점(ms) — v1과 동일 로직 */
export function calcScheduledRun(days: number[], hourKST: number, beforeOrAt: number): number {
  if (!days || days.length === 0) return beforeOrAt - 7 * 86400000;
  const KST = 9 * 3600000;
  for (let i = 0; i <= 7; i++) {
    const check = new Date(beforeOrAt - i * 86400000);
    check.setUTCHours(hourKST - 9, 0, 0, 0);
    const kstDay = new Date(check.getTime() + KST).getUTCDay();
    if (days.includes(kstDay) && check.getTime() <= beforeOrAt) return check.getTime();
  }
  return beforeOrAt - 7 * 86400000;
}

/* ── HTML → 텍스트·메타 ── */
export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}
export function extractOgImage(html: string): string | null {
  const meta =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
    html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (meta?.[1]?.startsWith("http")) return meta[1];
  const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*/gi)];
  for (const m of imgs) {
    const src = m[1];
    if (!src.startsWith("http")) continue;
    const lower = src.toLowerCase();
    if (["icon", "logo", "avatar", "sprite", "banner", "pixel", "tracking", ".svg", ".gif"].some((x) => lower.includes(x))) continue;
    const w = m[0].match(/width=["']?(\d+)/)?.[1];
    if (w && parseInt(w) < 200) continue;
    return src;
  }
  return null;
}
export function extractPublishedDate(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/* ── 동시성 ── */
export async function mapPool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} ${ms}ms 시간 초과`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 점 표기 경로로 중첩 값 읽기: getPath(obj, "a.b.c") */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}
