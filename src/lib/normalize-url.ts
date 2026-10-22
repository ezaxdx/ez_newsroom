// URL 정규화 — supabase/functions/curate-v2/lib/util.ts 의 normalizeUrl 과 반드시 같은 결과여야 함
// (curation_seen.url_key 를 앱에서 쓰고 큐레이션이 읽으므로, 한쪽만 바꾸면 중복 차단이 조용히 깨짐)
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
