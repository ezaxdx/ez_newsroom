// Supabase Edge Function — curate
// Deno 런타임 (Node.js 아님)
// googleapis 대신 Gmail REST API 직접 사용
// 실행 시간 제한: 150초 (Supabase 무료 플랜)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/* ── 타입 ── */
interface ApiConfig {
  endpoint: string;
  service_key_env: string;
  params: Record<string, string>;
  data_path: string;
  context_hint: string;
}
interface GmailConfig {
  sender_filter: string;
  subject_filter?: string;
  max_emails: number;
}

/* ── RSS XML 인코딩 감지 후 텍스트 변환 ── */
async function fetchRssText(url: string): Promise<string> {
  // 실제 브라우저 UA + 언어/consent 헤더 — 봇 차단·consent 페이지 우회
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  };
  // naver-rss-proxy 호출 시 Authorization 헤더 추가 (URL에 secret 노출 방지)
  if (url.includes("naver-rss-proxy")) {
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (cronSecret) headers["Authorization"] = `Bearer ${cronSecret}`;
    // 레거시 ?secret= 파라미터 제거
    const parsed = new URL(url);
    parsed.searchParams.delete("secret");
    url = parsed.toString();
  }
  // 구글뉴스는 데이터센터 IP에 consent 페이지를 주므로 쿠키로 우회
  if (url.includes("news.google.com")) {
    headers["Cookie"] = "CONSENT=YES+cb.20210328-17-p0.en+FX+000";
  }
  // 타임아웃·간헐 차단 대비 1회 재시도 (구글뉴스는 특히 불안정)
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      break;
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const buffer = await res!.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sniff = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200));
  const encMatch =
    sniff.match(/encoding=["']([^"']+)["']/i) ??
    res!.headers.get("content-type")?.match(/charset=([^\s;]+)/i);
  const encoding = (encMatch?.[1] ?? "utf-8").toLowerCase().replace("-", "");
  const decoder = new TextDecoder(
    encoding.includes("euckr") || encoding.includes("949") ? "euc-kr" : "utf-8",
    { fatal: false }
  );
  return decoder.decode(buffer);
}

/* ── RSS XML 파서 ── */
function extractCDATA(raw: string) {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/** 상대 URL → 절대 URL 변환 */
function toAbsoluteUrl(link: string, sourceUrl: string): string {
  if (link.startsWith("http")) return link;
  try {
    const base = new URL(sourceUrl);
    if (link.startsWith("/")) return `${base.protocol}//${base.host}${link}`;
    return `${base.protocol}//${base.host}/${link}`;
  } catch {
    return link;
  }
}

/**
 * Google News 기사 URL base64 디코딩
 * CBMi... 형식: bytes[0-2]=프로토버프 헤더, bytes[3]=URL길이, bytes[4~]=원문URL
 */
function decodeGoogleNewsArticleUrl(googleUrl: string): string | null {
  try {
    const match = googleUrl.match(/articles\/([A-Za-z0-9_=-]+)/);
    if (!match) return null;
    let b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // byte[3]이 URL 길이, byte[4~]부터 원문 URL
    if (bytes.length < 5) return null;
    const urlBytes = bytes.slice(4);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(urlBytes);
    const urlMatch = text.match(/^https?:\/\/[^\s\x00-\x08\x0e-\x1f]+/);
    if (!urlMatch) return null;
    // 비ASCII·제어문자 이후 잘라내기
    const cleaned = urlMatch[0].replace(/[\x00-\x1f\x7f-\x9f].*$/, "");
    return cleaned.startsWith("http") ? cleaned : null;
  } catch {
    return null;
  }
}

/**
 * 신형(AU_yqL) 구글뉴스 URL 복원 — 내부 batchexecute API 호출
 * 기사 페이지에서 서명(data-n-a-sg)·타임스탬프(data-n-a-ts) 추출 후 garturlreq 요청
 */
async function resolveViaBatchExecute(articleId: string): Promise<string | null> {
  // 데이터센터 IP는 동의(consent) 페이지를 받으므로 CONSENT 쿠키로 우회
  const commonHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+000",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  };
  try {
    const pageRes = await fetch(`https://news.google.com/articles/${articleId}`, {
      headers: commonHeaders,
      signal: AbortSignal.timeout(8000),
    });
    if (!pageRes.ok) { console.log(`[GNews] 페이지 ${pageRes.status} — ${articleId.slice(0, 12)}`); return null; }
    const html = await pageRes.text();
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts  = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sig || !ts) {
      console.log(`[GNews] 서명값 없음 (consent 페이지 의심) — ${articleId.slice(0, 12)} · html ${html.length}자`);
      return null;
    }

    const inner = JSON.stringify([
      "garturlreq",
      [["X","X",["ko","KR"],null,null,1,1,"KR:ko",null,null,null,null,null,null,null,0,5],
       "ko","KR",1,[2,4,8],1,1,null,0,0,null,0],
      articleId, Number(ts), sig,
    ]);
    const freq = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);

    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { ...commonHeaders, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `f.req=${encodeURIComponent(freq)}`,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.log(`[GNews] batchexecute ${res.status}`); return null; }
    const text = await res.text();
    const m = text.match(/garturlres\\",\\"(https?:[^\\"]+)/);
    if (!m) { console.log(`[GNews] garturlres 파싱 실패`); return null; }
    console.log(`[GNews] 복원 성공 → ${m[1].slice(0, 50)}`);
    return m[1];
  } catch (e) {
    console.log(`[GNews] 예외: ${(e as Error).message}`);
    return null;
  }
}

/** Google News 리다이렉트 → 실제 원문 URL 추출 */
async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!url.includes("news.google.com")) return url;

  const articleId = url.match(/articles\/([A-Za-z0-9_=-]+)/)?.[1];

  // 1단계: 구형 포맷 base64 디코딩 (HTTP 요청 없이)
  const decoded = decodeGoogleNewsArticleUrl(url);
  if (decoded) return decoded;

  // 2단계: 신형(AU_yqL) 포맷 — batchexecute API (2025~ 구글 인코딩 변경 대응)
  if (articleId) {
    const resolved = await resolveViaBatchExecute(articleId);
    if (resolved) return resolved;
  }

  // 3단계: HTTP 리다이렉트 폴백
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (res.url && !res.url.includes("news.google.com")) return res.url;
    const html = await res.text();
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
    if (canonical && !canonical.includes("news.google.com")) return canonical;
    const jsRedirect = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/)?.[1];
    if (jsRedirect && jsRedirect.startsWith("http")) return jsRedirect;
  } catch {
    // 실패 시 원본 URL 그대로 사용
  }
  return url;
}

function parseRSS(xml: string, limit = 40) {
  const items: { title: string; link: string; pubDate: string; description: string }[] = [];
  // <item>(RSS 2.0) 뿐 아니라 <entry>(Atom)도 처리 — 네이버 블로그 등은 형식이 섞임
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
  for (const m of matches) {
    const c = m[1];
    const title = extractCDATA(c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = extractCDATA(
      c.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ??
      c.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? ""
    );
    const pubDate = c.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim()
      ?? c.match(/<published>([\s\S]*?)<\/published>/i)?.[1]?.trim()
      ?? c.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.trim() ?? "";
    // 본문: content:encoded(전문) 우선, 없으면 description/summary. 봇 차단으로 원문 스크래핑이
    // 막히는 소스(네이버 블로그 등)는 이 RSS 본문을 폴백으로 사용해 발행 실패를 막음.
    const rawBody =
      c.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)?.[1] ??
      c.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ??
      c.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ??
      c.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
    const description = extractText(extractCDATA(rawBody));
    if (title && link) items.push({ title, link, pubDate, description });
  }
  return items.slice(0, limit);
}

/* ── HTML에서 본문 텍스트 추출 (순수 함수) ── */
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

/* ── HTML에서 OG 이미지 추출 (순수 함수) ── */
function extractOgImage(html: string): string | null {
  // 1단계: OG / Twitter 메타 태그
  const meta =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
    html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (meta?.[1]?.startsWith("http")) return meta[1];

  // 2단계: 본문 첫 번째 의미 있는 <img> 태그
  const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*/gi)];
  for (const match of imgMatches) {
    const src = match[1];
    if (!src.startsWith("http")) continue;
    const lower = src.toLowerCase();
    if (["icon", "logo", "avatar", "sprite", "banner", "pixel", "tracking", ".svg", ".gif"]
      .some((x) => lower.includes(x))) continue;
    const w = match[0].match(/width=["']?(\d+)/)?.[1];
    if (w && parseInt(w) < 200) continue;
    return src;
  }
  return null;
}

/* ── 원문 1회 fetch로 본문+이미지 동시 추출 (기사당 요청 2회→1회) ── */
async function fetchArticleData(url: string): Promise<{ text: string; image_url: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(7000),
    });
    const html = await res.text();
    return { text: extractText(html), image_url: extractOgImage(html) };
  } catch {
    return { text: "", image_url: null };
  }
}

/* ── 카테고리 기본 이미지 (OG 추출 완전 실패 시 최종 폴백) ── */
const CATEGORY_DEFAULT_IMAGES: Record<string, string> = {
  AI:      "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&fit=crop&q=80",
  MICE:    "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&fit=crop&q=80",
  TOURISM: "https://images.unsplash.com/photo-1539635278303-d4002c07eae3?w=800&fit=crop&q=80",
};
function getCategoryDefaultImage(category: string): string {
  return CATEGORY_DEFAULT_IMAGES[category.toUpperCase()] ??
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&fit=crop&q=80";
}

/* ── 날짜 안전 파싱 ── */
function safeDateISO(raw: string | undefined | null): string {
  if (!raw) return new Date().toISOString();
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/* ── 공공 API 데이터 fetch ── */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && !Array.isArray(acc))
      return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}
function autoBaseYm(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}
async function fetchApiData(
  baseUrl: string,
  config: ApiConfig
): Promise<{ text: string; articleUrl: string } | null> {
  try {
    const serviceKey = Deno.env.get(config.service_key_env);
    if (!serviceKey) return null;
    const params = new URLSearchParams();
    params.set("serviceKey", serviceKey);
    for (const [k, v] of Object.entries(config.params))
      params.set(k, v === "auto" && k === "baseYm" ? autoBaseYm() : v);
    const fullUrl = `${baseUrl}${config.endpoint}?${params.toString()}`;
    const res = await fetch(fullUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const items = getNestedValue(json, config.data_path);
    const arr = Array.isArray(items) ? items : items ? [items] : [];
    if (!arr.length) return null;
    const baseYm = config.params["baseYm"] === "auto" ? autoBaseYm() : (config.params["baseYm"] ?? "");
    const header = `[${config.context_hint}] 기준연월: ${baseYm}\n\n`;
    const rows = arr.slice(0, 20).map((item, i) => {
      if (typeof item !== "object" || !item) return "";
      return `${i + 1}. ${Object.entries(item as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(" | ")}`;
    }).join("\n");
    return { text: (header + rows).slice(0, 6000), articleUrl: `${baseUrl}${config.endpoint}` };
  } catch {
    return null;
  }
}

/* ── 네이버 뉴스 검색 API ── */
// 정식 인증 API라 구글뉴스처럼 IP 차단/타임아웃 위험이 없음.
// source.url을 검색어로 사용 (예: "MICE", "스마트관광"). 인증은 HTTP 헤더로 전달.

function stripNaverMarkup(s: string): string {
  return s
    .replace(/<\/?b>/g, "")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

async function fetchNaverNews(query: string): Promise<{ title: string; link: string; pubDate: string; description: string }[]> {
  const clientId = Deno.env.get("NAVER_CLIENT_ID");
  const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.log("[네이버뉴스] NAVER_CLIENT_ID/SECRET 환경변수 없음 — 스킵");
    return [];
  }
  try {
    const params = new URLSearchParams({ query, display: "20", sort: "date" });
    const res = await fetch(`https://openapi.naver.com/v1/search/news.json?${params.toString()}`, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log(`[네이버뉴스] "${query}" API 오류 ${res.status}`);
      return [];
    }
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((it: { title?: string; originallink?: string; link?: string; pubDate?: string; description?: string }) => ({
      title: stripNaverMarkup(it.title ?? ""),
      // 원문 URL 우선, 없으면 네이버뉴스 링크
      link: it.originallink || it.link || "",
      pubDate: it.pubDate ?? "",
      // API가 주는 요약문 — 원문 스크래핑이 막힐 때 폴백용
      description: stripNaverMarkup(it.description ?? ""),
    })).filter((it: { title: string; link: string }) => it.title && it.link);
  } catch (e) {
    console.log(`[네이버뉴스] "${query}" 요청 실패:`, (e as Error).message);
    return [];
  }
}

/* ── Gmail 토큰 복호화 (AES-GCM) ── */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function decryptToken(encrypted: string): Promise<string> {
  const keyHex = Deno.env.get("GMAIL_ENCRYPTION_KEY");
  if (!keyHex) throw new Error("GMAIL_ENCRYPTION_KEY 없음");
  const [ivHex, ciphertextHex] = encrypted.split(":");
  if (!ivHex || !ciphertextHex) return encrypted; // 암호화 전 평문 토큰 하위 호환
  const key = await crypto.subtle.importKey(
    "raw", hexToBytes(keyHex.slice(0, 64)), { name: "AES-GCM" }, false, ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(ivHex) },
    key,
    hexToBytes(ciphertextHex)
  );
  return new TextDecoder().decode(decrypted);
}

async function encryptToken(plaintext: string): Promise<string> {
  const keyHex = Deno.env.get("GMAIL_ENCRYPTION_KEY");
  if (!keyHex) return plaintext;
  const key = await crypto.subtle.importKey(
    "raw", hexToBytes(keyHex.slice(0, 64)), { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)
  );
  const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${toHex(iv)}:${toHex(new Uint8Array(ciphertext))}`;
}

/* ── Gmail REST API — 토큰 갱신 ── */
async function refreshGmailToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
        client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = await res.json();
    if (!json.access_token) return null;
    const encAccess = await encryptToken(json.access_token);
    await supabase.from("gmail_tokens").update({
      access_token: encAccess,
      expiry_date: Date.now() + (json.expires_in ?? 3600) * 1000,
      updated_at: new Date().toISOString(),
    }).eq("id", "singleton");
    return json.access_token; // 복호화된 값 반환 (이후 API 호출에 사용)
  } catch {
    return null;
  }
}

/* ── Gmail base64 디코딩 (Deno용 — Node.js Buffer 없음) ── */
function decodeBase64(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/* ── Gmail HTML 본문 추출 ── */
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailHeader { name: string; value: string }
interface GmailMessage {
  payload?: GmailPart & { headers?: GmailHeader[] };
}
function extractHtmlBody(payload: GmailPart): string {
  if (!payload) return "";
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = extractHtmlBody(part);
      if (found) return found;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data)
    return decodeBase64(payload.body.data);
  return "";
}

/* ── Gmail 기사 링크 추출 ── */
function extractArticleLinks(html: string, senderDomain: string): { title: string; url: string }[] {
  const domainParts = senderDomain.split("@")[1]?.split(".") ?? [];
  const coreDomain = domainParts.slice(-2).join(".");
  const results: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1];
    const rawTitle = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!url.startsWith("http")) continue;
    if (url.includes("unsubscribe") || url.includes("optout") || url.includes("click.")) continue;
    if (!url.includes(coreDomain)) continue;
    if (seen.has(url)) continue;
    if (rawTitle.length < 5) continue;
    seen.add(url);
    results.push({ title: rawTitle, url });
  }
  return results;
}

/* ── Gmail 뉴스레터 수집 (REST API) ── */
async function fetchGmailNewsletters(
  config: GmailConfig
): Promise<{ title: string; link: string; pubDate: string }[]> {
  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expiry_date")
    .eq("id", "singleton")
    .single();

  if (!tokenRow?.refresh_token) {
    console.error("[Gmail] 저장된 토큰 없음");
    return [];
  }

  // 저장된 토큰 복호화
  let accessToken: string | null = null;
  try {
    accessToken = tokenRow.access_token ? await decryptToken(tokenRow.access_token) : null;
  } catch { accessToken = null; }

  const isExpired = !accessToken || (tokenRow.expiry_date && Date.now() > tokenRow.expiry_date - 60000);
  if (isExpired) {
    const decryptedRefresh = tokenRow.refresh_token ? await decryptToken(tokenRow.refresh_token).catch(() => tokenRow.refresh_token) : null;
    if (!decryptedRefresh) { console.error("[Gmail] refresh_token 없음"); return []; }
    accessToken = await refreshGmailToken(decryptedRefresh);
    if (!accessToken) { console.error("[Gmail] 토큰 갱신 실패"); return []; }
  }

  const query = [
    `from:${config.sender_filter}`,
    config.subject_filter ? `subject:${config.subject_filter}` : "",
    "newer_than:7d",
  ].filter(Boolean).join(" ");

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${config.max_emails ?? 3}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listJson = await listRes.json();
  const messages: { id: string }[] = listJson.messages ?? [];
  const results: { title: string; link: string; pubDate: string }[] = [];

  for (const msg of messages) {
    try {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const detail: GmailMessage = await detailRes.json();
      const headers = detail.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(제목 없음)";
      const date = headers.find((h) => h.name === "Date")?.value ?? "";
      const htmlBody = extractHtmlBody(detail.payload ?? {});
      if (!htmlBody) continue;
      const articleLinks = extractArticleLinks(htmlBody, config.sender_filter);
      if (articleLinks.length === 0) {
        results.push({ title: subject, link: `gmail:${msg.id}`, pubDate: date });
      } else {
        for (const link of articleLinks.slice(0, 3))
          results.push({ title: link.title || subject, link: link.url, pubDate: date });
      }
    } catch (e) {
      console.error("[Gmail 메시지 파싱 오류]", e);
    }
  }
  return results;
}

/* ── Claude 기사 생성 ── */
async function generateArticle(
  apiKey: string, articleText: string, url: string,
  persona: string, audience: string, keywords: string[],
  levelPrompts: Record<string, string>,
  companyContext?: string
): Promise<{ title: string; summary_short: string; content_long: string; implications: string; level: string; quality_score: number; quality_criteria: { relevance: number; specificity: number; practicality: number; source_quality: number } } | null> {
  const keywordHint = keywords.length ? `\n강조 키워드: ${keywords.join(", ")}` : "";
  const userPrompt = `${persona}
타겟 독자: ${audience}${keywordHint}

퀄리티 점수 기준 (각 항목 1~10점, quality_score는 종합 판단):
- relevance(카테고리 관련성): 카테고리·페르소나·키워드와의 일치도
- specificity(구체성): 수치·사례·데이터의 풍부함
- practicality(실용성): 즉시 활용 가능한 시사점 여부
- source_quality(원문품질): 원문 접근 가능성 및 내용 충실도
- quality_score(종합): 위 4항목을 종합한 최종 점수
  9~10: 업계 핵심 인사이트, 구체적 수치/사례 풍부, 즉시 실행 가능한 시사점
  7~8: 관련성 높고 실용적, 부분적으로 구체적
  5~6: 일반적 내용, 시사점이 다소 추상적
  3~4: 관련성 낮거나 원문 접근 불가로 내용 빈약
  1~2: 카테고리와 무관하거나 정보 없음

레벨 판정 (체크리스트로 엄격히 판단):

Beginner — 다음 중 1개 이상 해당하면 Beginner:
  * 기술·서비스·제도를 처음 소개하는 입문성 기사
  * "~란 무엇인가", "~가 뜨는 이유" 등 개념·배경 설명 중심
  * 업계에 막 입문한 신입 직원이 맥락 파악을 위해 읽으면 좋을 내용
  * 특정 트렌드·기술이 왜 중요한지 배경부터 설명하는 기사
  * 실무 경험 없이도 전체 흐름을 이해할 수 있는 내용

Advanced — 다음 중 1개 이상 해당하면 Advanced:
  * 기술 아키텍처·알고리즘·정책 조항의 심층 분석
  * 시장 구조 변화·경쟁 구도·M&A·투자 전략 분석
  * 정량 데이터(수치, 통계)를 바탕으로 2차·3차 파급효과 분석
  * C레벨·투자자 의사결정에 직결되는 전략적 내용

Intermediate — 위 두 조건 모두 해당 없을 때

레벨별 작성 지침:
[Beginner] ${levelPrompts["Beginner"] ?? "쉽고 명확하게 작성하세요."}
[Intermediate] ${levelPrompts["Intermediate"] ?? "실무 담당자 관점에서 작성하세요."}
[Advanced] ${levelPrompts["Advanced"] ?? "전략적 심층 분석으로 작성하세요."}

문체 규칙: '~습니다/~입니다' 경어체로 작성하되, 딱딱하지 않고 읽기 편한 뉴스레터 톤으로 작성하세요. 신문체('~다', '~한다') 사용 금지.

다음 기사를 분석해 JSON으로만 응답하세요 (마크다운 없이):
{"quality_score":8,"quality_criteria":{"relevance":9,"specificity":8,"practicality":7,"source_quality":8},"level":"Intermediate","title":"제목(50자이내)","summary_short":"요약(120자이내)","content_long":"상세분석(4~6문장)","implications":"시사점(2~3문장)"}

원문 URL: ${url}
${articleText.length > 50 ? `원문:\n${articleText}` : "(원문 접근 불가 — 제목과 URL을 바탕으로 작성해주세요)"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          ...(companyContext?.trim() ? { systemInstruction: { parts: [{ text: companyContext.trim() }] } } : {}),
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const json = await res.json();
    if (!res.ok) { console.error("[Gemini error]", json); return null; }
    const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(raw);
  } catch (e) {
    console.error("[Claude error]", e);
    return null;
  }
}

/* ── 메인 핸들러 ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });

  const authHeader = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const validAuth = !cronSecret
    || authHeader === `Bearer ${cronSecret}`
    || cronHeader === cronSecret
    || authHeader === `Bearer ${serviceRoleKey}`;
  if (!validAuth)
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY 없음" }), { status: 500 });

  const { data: sourcesRaw } = await supabase.from("rss_sources").select("*").eq("is_active", true);
  if (!sourcesRaw?.length) return new Response(JSON.stringify({ error: "활성 소스 없음" }), { status: 400 });
  // weight 높은 순으로 처리 — 시간예산 초과 시 중요 소스가 먼저 돌고 낮은 것만 밀림
  const sources = [...sourcesRaw].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

  const { data: settings } = await supabase
    .from("curation_settings").select("category_settings, level_prompts, quality_thresholds, company_context, focus_keywords")
    .limit(1).single();
  const catSettings: Record<string, { audience: string; persona: string; keywords: string[] }> = settings?.category_settings ?? {};
  const allLevelPrompts: Record<string, Record<string, string>> = settings?.level_prompts ?? {};
  const qualityThresholds = settings?.quality_thresholds ?? { auto_publish: 8, staging: 5 };
  const companyContext: string = settings?.company_context ?? "";

  // 관심 키워드: 언론사 전체피드(keyword_filter=true)에서 관련 기사만 통과시킴
  // curation_settings.focus_keywords 우선, 없으면 기본값(회사 검색어)
  const DEFAULT_FOCUS = [
    "MICE", "마이스", "전시회", "박람회", "엑스포", "국제회의", "컨벤션",
    "관광", "스마트관광", "글로컬관광", "관광공사", "여행",
    "AI", "인공지능", "AX", "디지털전환", "스마트",
  ];
  const focusKeywords: string[] = (settings?.focus_keywords?.length ? settings.focus_keywords : DEFAULT_FOCUS)
    .map((k: string) => k.toLowerCase());
  const matchesFocus = (title: string) => {
    const t = title.toLowerCase();
    return focusKeywords.some((kw) => t.includes(kw));
  };

  // 키워드 → 카테고리 매핑 (언론사 전체피드는 소스 고정 카테고리가 아니라
  // 실제 매칭된 키워드 기준으로 카테고리를 재배정해야 함 — 안 그러면
  // "AI" 매칭 기사가 MICE로 등록된 연합뉴스에서 그대로 MICE로 들어가는 등 카테고리가 섞임)
  const KEYWORD_CATEGORY_MAP: Record<string, string> = {
    "mice": "MICE", "마이스": "MICE", "전시회": "MICE", "박람회": "MICE",
    "엑스포": "MICE", "국제회의": "MICE", "컨벤션": "MICE",
    "관광": "TOURISM", "스마트관광": "TOURISM", "글로컬관광": "TOURISM",
    "ai관광": "TOURISM", "관광공사": "TOURISM", "여행": "TOURISM",
    "ai": "AI", "인공지능": "AI", "ax": "AI", "dx": "AI", "디지털전환": "AI", "스마트": "AI",
  };
  // 긴 키워드부터 검사 (짧은 범용어가 복합어보다 먼저 걸려 오분류되는 것 방지 —
  // 예: "AI 관광" 기사가 "AI관광" 매칭 실패 후 짧은 "AI"에 먼저 걸려 관광 기사가 AI로 잘못 분류되는 문제)
  const categoryMappedKeywords = focusKeywords
    .filter((kw) => KEYWORD_CATEGORY_MAP[kw])
    .sort((a, b) => b.length - a.length);
  // 제목에 매칭된 키워드 중 카테고리 매핑이 있는 것으로 재배정, 없으면 폴백(소스 기본 카테고리)
  // 소스 유형(keyword_filter 여부)과 무관하게 항상 "실제 내용"을 기준으로 카테고리를 정함
  function resolveArticleCategory(title: string, fallback: string): string {
    const t = title.toLowerCase();
    for (const kw of categoryMappedKeywords) {
      if (t.includes(kw)) return KEYWORD_CATEGORY_MAP[kw];
    }
    return fallback;
  }
  const PER_SOURCE_LIMIT = 10; // 소스당 처리 상한 (필터 후)

  const { data: existingNews } = await supabase.from("news").select("original_url");
  const existingUrls = new Set((existingNews ?? []).map((n: { original_url: string }) => n.original_url));
  const results = { published: 0, staged: 0, skipped: 0, failed: 0 };
  const runStart = Date.now();
  const scoreDist: Record<string, number> = {};
  const sourceStats: Array<{ name: string; type: string; fetched: number; published: number; staged: number; skipped: number; failed: number }> = [];
  const runErrors: Array<{ source: string; url?: string; error: string }> = [];

  // 동시개최 중복 제거: 같은 venue + 같은 시작일 조합은 1건만 허용
  const venueDateSeen = new Set<string>();
  const VENUES = ["킨텍스", "코엑스", "벡스코", "엑스코", "aT센터", "세텍", "KINTEX", "COEX", "BEXCO", "EXCO"];
  function extractVenueDateKey(text: string): string | null {
    const venue = VENUES.find((v) => text.includes(v));
    if (!venue) return null;
    const dateMatch = text.match(/\d{4}[-./]?\d{2}[-./]?\d{2}/);
    if (!dateMatch) return null;
    return `${venue}:${dateMatch[0].replace(/[-./]/g, "")}`;
  }

  const TIME_BUDGET_MS = 130_000; // Edge Function 150초 한계 대비 — 초과 시 남은 소스 스킵
  let budgetExceeded = false;
  // 소스 단위 체크만으론 부족함 — 기사 1건당 원문스크래핑+AI생성이 느린 소스(네이버뉴스 등)는
  // 소스 하나 처리하는 도중에도 예산을 넘겨 플랫폼에 강제 종료(shutdown)당할 수 있음.
  // 그러면 로그도 안 남고 이번 소스는 통째로 날아가니, 기사 단위로도 예산 체크 필요.
  const overBudget = () => Date.now() - runStart > TIME_BUDGET_MS;

  for (const source of sources) {
    // 시간 예산 초과 시 남은 소스는 다음 실행으로 미룸 (강제 종료 방지)
    if (Date.now() - runStart > TIME_BUDGET_MS) {
      budgetExceeded = true;
      console.log(`[시간예산 초과] ${source.source_name} 이후 소스 스킵`);
      break;
    }
    const category = source.default_category.toUpperCase();
    const stat = { name: source.source_name, type: source.source_type, fetched: 0, published: 0, staged: 0, skipped: 0, failed: 0 };
    sourceStats.push(stat);

    const insertArticle = async (articleText: string, url: string, image_url: string | null, pubDate?: string, categoryOverride?: string) => {
      stat.fetched++;
      // 키워드 필터 소스는 실제 매칭된 키워드 기준 카테고리로 재배정 (일반 소스는 고정 카테고리 그대로)
      const cat = categoryOverride ?? category;
      const setting = catSettings[cat] ?? {
        audience: "MICE·관광 업계 종사자",
        persona: `당신은 ${cat} 전문 에디터입니다. 업계 종사자 관점에서 핵심 시사점을 분석합니다.`,
        keywords: [],
      };
      const catLevelPrompts = allLevelPrompts[cat] ?? {};
      // 원문이 너무 짧으면 (봇 차단·접근 불가) 스킵 — 환각 기사 방지
      if (articleText.length < 200) {
        console.log(`[SKIP] 원문 너무 짧음 (${articleText.length}자): ${url}`);
        results.skipped++; stat.skipped++;
        existingUrls.add(url);
        return;
      }
      // 동시개최 중복 제거: 같은 장소·날짜 조합이 이미 처리됐으면 스킵
      const vdKey = extractVenueDateKey(articleText);
      if (vdKey && venueDateSeen.has(vdKey)) {
        console.log(`[SKIP] 동시개최 중복 (${vdKey}): ${url}`);
        results.skipped++; stat.skipped++;
        existingUrls.add(url);
        return;
      }
      if (vdKey) venueDateSeen.add(vdKey);
      const generated = await generateArticle(apiKey, articleText, url, setting.persona, setting.audience, setting.keywords, catLevelPrompts, companyContext);
      if (!generated) { results.failed++; stat.failed++; runErrors.push({ source: source.source_name, url, error: "generateArticle 실패" }); return; }
      const score = generated.quality_score ?? 5;
      scoreDist[score] = (scoreDist[score] ?? 0) + 1;
      if (score < qualityThresholds.staging) { results.skipped++; stat.skipped++; existingUrls.add(url); return; }
      const shouldAutoPublish = score >= qualityThresholds.auto_publish;
      const { error } = await supabase.from("news").upsert({
        title: generated.title, summary_short: generated.summary_short,
        content_long: generated.content_long, implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url: image_url ?? getCategoryDefaultImage(cat),
        original_url: url,
        category: cat, quality_score: score,
        quality_criteria: generated.quality_criteria ?? null,
        is_published: shouldAutoPublish,
        priority_score: source.weight * 10, display_order: 1000 - score * 10,
        published_at: shouldAutoPublish ? new Date().toISOString() : safeDateISO(pubDate),
      }, { onConflict: "original_url", ignoreDuplicates: true });
      if (error) {
        console.error("[DB upsert 실패]", error.message, url);
        results.failed++; stat.failed++;
        runErrors.push({ source: source.source_name, url, error: error.message });
      } else {
        if (shouldAutoPublish) { results.published++; stat.published++; }
        else { results.staged++; stat.staged++; }
        existingUrls.add(url);
      }
    };

    if (source.source_type === "url") {
      if (existingUrls.has(source.url)) { results.skipped++; continue; }
      const { text: articleText, image_url } = await fetchArticleData(source.url);
      await insertArticle(articleText, source.url, image_url);
      continue;
    }

    if (source.source_type === "api") {
      const cfg = source.api_config as ApiConfig | null;
      if (!cfg?.endpoint) { results.skipped++; continue; }
      const apiResult = await fetchApiData(source.url, cfg);
      if (!apiResult) { results.failed++; continue; }
      if (existingUrls.has(apiResult.articleUrl)) { results.skipped++; continue; }
      await insertArticle(apiResult.text, apiResult.articleUrl, null);
      continue;
    }

    if (source.source_type === "gmail") {
      const cfg = source.api_config as GmailConfig | null;
      if (!cfg?.sender_filter) { results.skipped++; continue; }
      try {
        const gmailItems = await fetchGmailNewsletters(cfg);
        console.log(`[Gmail] ${source.source_name}: ${gmailItems.length}개`);
        for (const item of gmailItems) {
          if (overBudget()) { budgetExceeded = true; console.log(`[시간예산 초과] ${source.source_name} 처리 중 중단`); break; }
          // gmail:msgId → 원문 링크 없음, 스킵
          if (item.link.startsWith("gmail:")) { results.skipped++; continue; }
          if (existingUrls.has(item.link)) { results.skipped++; continue; }
          const { text: articleText, image_url } = await fetchArticleData(item.link);
          await insertArticle(articleText, item.link, image_url, item.pubDate);
        }
      } catch (e) {
        console.error(`[Gmail 실패]`, e);
        results.failed++;
      }
      continue;
    }

    if (source.source_type === "naver_news") {
      // source.url = 검색어 (예: "MICE", "스마트관광"). 인증 API라 구글뉴스와 달리 IP 차단 없음.
      try {
        const naverItems = (await fetchNaverNews(source.url)).slice(0, PER_SOURCE_LIMIT);
        console.log(`[네이버뉴스] "${source.url}": ${naverItems.length}개`);
        for (const item of naverItems) {
          if (overBudget()) { budgetExceeded = true; console.log(`[시간예산 초과] ${source.source_name} 처리 중 중단`); break; }
          if (existingUrls.has(item.link)) { results.skipped++; continue; }
          const { text: scraped, image_url } = await fetchArticleData(item.link);
          // 원문 스크래핑이 짧게 잡히면 API가 준 요약문으로 폴백
          const articleText = scraped.length >= 200 ? scraped
            : (item.description.length > scraped.length ? item.description : scraped);
          // 검색어 기반 소스라 실제 제목 내용으로 카테고리 재배정 (RSS와 동일 원칙)
          const categoryOverride = resolveArticleCategory(item.title, category);
          await insertArticle(articleText, item.link, image_url, item.pubDate, categoryOverride);
        }
      } catch (e) {
        console.error(`[네이버뉴스 실패] ${source.source_name}:`, e);
        results.failed++;
      }
      continue;
    }

    // RSS
    try {
      const xml = await fetchRssText(source.url);
      let rssItems = parseRSS(xml);

      // 언론사 전체피드는 관심 키워드 매칭 기사만 통과 (제목 기준)
      if (source.keyword_filter) {
        const before = rssItems.length;
        rssItems = rssItems.filter((it) => matchesFocus(it.title));
        console.log(`[RSS] ${source.source_name}: ${before}개 → 키워드 매칭 ${rssItems.length}개`);
      } else {
        console.log(`[RSS] ${source.source_name}: ${rssItems.length}개`);
      }
      // 소스당 처리 상한
      rssItems = rssItems.slice(0, PER_SOURCE_LIMIT);

      // URL 해석 병렬처리 후 기사 생성은 순차처리 (Claude 병렬 호출 방지)
      const resolved = await Promise.all(
        rssItems.map(async (item) => {
          const absLink = toAbsoluteUrl(item.link, source.url);
          const resolvedLink = await resolveGoogleNewsUrl(absLink);
          return { ...item, link: resolvedLink };
        })
      );
      for (const item of resolved) {
        if (overBudget()) { budgetExceeded = true; console.log(`[시간예산 초과] ${source.source_name} 처리 중 중단`); break; }
        if (existingUrls.has(item.link)) { results.skipped++; continue; }
        const { text: scraped, image_url } = await fetchArticleData(item.link);
        // 원문 스크래핑이 봇 차단 등으로 짧게 잡히면 RSS 본문(description/content:encoded)으로 폴백
        const articleText = scraped.length >= 200 ? scraped
          : (item.description.length > scraped.length ? item.description : scraped);
        // 소스 고정 카테고리가 아니라 실제 제목 내용으로 재배정
        // (예: "Google News_MICE Tech"처럼 키워드 필터 없는 소스도 AI 기사를 물어올 수 있음 —
        //  소스 유형과 무관하게 항상 내용 기준으로 분류해야 MICE/AI가 섞이지 않음)
        const categoryOverride = resolveArticleCategory(item.title, category);
        await insertArticle(articleText, item.link, image_url, item.pubDate, categoryOverride);
      }
    } catch (e) {
      console.error(`[RSS 실패] ${source.source_name}:`, e);
      results.failed++;
    }
  }

  // 오래된 대기열(30일 이상 미발행) 자동 정리 — 검토 없이 무기한 누적되는 것 방지.
  // published_at은 미발행 기사의 경우 원문 발행일(pubDate)이라 삽입 시점과 정확히 일치하진
  // 않지만, RSS 특성상 수집 직후 값이라 충분히 근사치로 사용 가능.
  const cleanupCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: cleanedUp, error: cleanupError } = await supabase
    .from("news")
    .delete({ count: "exact" })
    .eq("is_published", false)
    .lt("published_at", cleanupCutoff);
  if (cleanupError) console.error("[대기열 정리 실패]", cleanupError.message);
  else if (cleanedUp) console.log(`[대기열 정리] 30일 경과 미발행 기사 ${cleanedUp}건 삭제`);

  const durationMs = Date.now() - runStart;
  const fetched = sourceStats.reduce((s, r) => s + r.fetched, 0);
  console.log(`[완료] published:${results.published} staged:${results.staged} skipped:${results.skipped} failed:${results.failed} (${durationMs}ms)`);
  const { error: logError } = await supabase.from("curation_logs").insert({
    duration_ms: durationMs,
    fetched,
    published: results.published,
    staged: results.staged,
    skipped: results.skipped,
    failed: results.failed,
    score_dist: scoreDist,
    source_stats: sourceStats,
    errors: budgetExceeded ? [...runErrors, { source: "(시스템)", error: "시간예산 초과로 일부 소스 스킵" }] : runErrors,
  });
  if (logError) console.error("[curation_logs insert 실패]", logError.message);
  return new Response(JSON.stringify({ ok: true, ...results, budget_exceeded: budgetExceeded, duration_ms: durationMs }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
