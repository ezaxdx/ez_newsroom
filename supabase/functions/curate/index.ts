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
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)",
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
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sniff = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200));
  const encMatch =
    sniff.match(/encoding=["']([^"']+)["']/i) ??
    res.headers.get("content-type")?.match(/charset=([^\s;]+)/i);
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

/** Google News 리다이렉트 → 실제 원문 URL 추출 */
async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!url.includes("news.google.com")) return url;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    // 리다이렉트 후 최종 URL 반환
    if (res.url && !res.url.includes("news.google.com")) return res.url;
    // 리다이렉트가 안 된 경우 HTML에서 실제 링크 추출
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

function parseRSS(xml: string) {
  const items: { title: string; link: string; pubDate: string }[] = [];
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const m of matches) {
    const c = m[1];
    const title = extractCDATA(c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = extractCDATA(
      c.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ??
      c.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? ""
    );
    const pubDate = c.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ?? "";
    if (title && link) items.push({ title, link, pubDate });
  }
  return items.slice(0, 3);
}

/* ── 원문 텍스트 추출 ── */
async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(7000),
    });
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch {
    return "";
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

/* ── OG 이미지 추출 — 3단계 시도 ── */
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();

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
      const tagStr = match[0];
      const w = tagStr.match(/width=["']?(\d+)/)?.[1];
      if (w && parseInt(w) < 200) continue;
      return src;
    }

    return null;
  } catch {
    return null;
  }
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
): Promise<{ title: string; summary_short: string; content_long: string; implications: string; level: string; quality_score: number } | null> {
  const keywordHint = keywords.length ? `\n강조 키워드: ${keywords.join(", ")}` : "";
  const userPrompt = `${persona}
타겟 독자: ${audience}${keywordHint}

퀄리티 점수 기준 (1~10):
- 9~10: 업계 핵심 인사이트, 구체적 수치/사례 풍부, 즉시 실행 가능한 시사점
- 7~8: 관련성 높고 실용적, 부분적으로 구체적
- 5~6: 일반적 내용, 시사점이 다소 추상적
- 3~4: 관련성 낮거나 원문 접근 불가로 내용 빈약
- 1~2: 카테고리와 무관하거나 정보 없음

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
{"quality_score":점수,"level":"레벨","title":"제목(50자이내)","summary_short":"요약(120자이내)","content_long":"상세분석(4~6문장)","implications":"시사점(2~3문장)"}

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

  const { data: sources } = await supabase.from("rss_sources").select("*").eq("is_active", true);
  if (!sources?.length) return new Response(JSON.stringify({ error: "활성 소스 없음" }), { status: 400 });

  const { data: settings } = await supabase
    .from("curation_settings").select("category_settings, level_prompts, quality_thresholds, company_context")
    .limit(1).single();
  const catSettings: Record<string, { audience: string; persona: string; keywords: string[] }> = settings?.category_settings ?? {};
  const allLevelPrompts: Record<string, Record<string, string>> = settings?.level_prompts ?? {};
  const qualityThresholds = settings?.quality_thresholds ?? { auto_publish: 8, staging: 5 };
  const companyContext: string = settings?.company_context ?? "";

  await supabase.from("news").delete().eq("is_published", false);

  const { data: existingNews } = await supabase.from("news").select("original_url");
  const existingUrls = new Set((existingNews ?? []).map((n: { original_url: string }) => n.original_url));
  const results = { created: 0, skipped: 0, failed: 0 };

  for (const source of sources) {
    const category = source.default_category.toUpperCase();
    const setting = catSettings[category] ?? {
      audience: "MICE·관광 업계 종사자",
      persona: `당신은 ${category} 전문 에디터입니다. 업계 종사자 관점에서 핵심 시사점을 분석합니다.`,
      keywords: [],
    };
    const catLevelPrompts = allLevelPrompts[category] ?? {};

    const insertArticle = async (articleText: string, url: string, image_url: string | null, pubDate?: string) => {
      // 원문이 너무 짧으면 (봇 차단·접근 불가) 스킵 — 환각 기사 방지
      if (articleText.length < 200) {
        console.log(`[SKIP] 원문 너무 짧음 (${articleText.length}자): ${url}`);
        results.skipped++;
        existingUrls.add(url);
        return;
      }
      const generated = await generateArticle(apiKey, articleText, url, setting.persona, setting.audience, setting.keywords, catLevelPrompts, companyContext);
      if (!generated) { results.failed++; return; }
      const score = generated.quality_score ?? 5;
      if (score < qualityThresholds.staging) { results.skipped++; existingUrls.add(url); return; }
      const shouldAutoPublish = score >= qualityThresholds.auto_publish;
      const { error } = await supabase.from("news").insert({
        title: generated.title, summary_short: generated.summary_short,
        content_long: generated.content_long, implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url: image_url ?? getCategoryDefaultImage(category),
        original_url: url,
        category, quality_score: score, is_published: shouldAutoPublish,
        priority_score: source.weight * 10, display_order: 1000 - score * 10,
        published_at: shouldAutoPublish ? new Date().toISOString() : safeDateISO(pubDate),
      });
      if (error) { console.error("[DB insert 실패]", error.message, url); results.failed++; }
      else { results.created++; existingUrls.add(url); }
    };

    if (source.source_type === "url") {
      if (existingUrls.has(source.url)) { results.skipped++; continue; }
      const [articleText, image_url] = await Promise.all([fetchArticleText(source.url), fetchOgImage(source.url)]);
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
          // gmail:msgId → 원문 링크 없음, 스킵
          if (item.link.startsWith("gmail:")) { results.skipped++; continue; }
          if (existingUrls.has(item.link)) { results.skipped++; continue; }
          const [articleText, image_url] = await Promise.all([fetchArticleText(item.link), fetchOgImage(item.link)]);
          await insertArticle(articleText, item.link, image_url, item.pubDate);
        }
      } catch (e) {
        console.error(`[Gmail 실패]`, e);
        results.failed++;
      }
      continue;
    }

    // RSS
    try {
      const xml = await fetchRssText(source.url);
      const rssItems = parseRSS(xml);
      console.log(`[RSS] ${source.source_name}: ${rssItems.length}개`);

      // URL 해석 병렬처리 후 기사 생성은 순차처리 (Claude 병렬 호출 방지)
      const resolved = await Promise.all(
        rssItems.map(async (item) => {
          const absLink = toAbsoluteUrl(item.link, source.url);
          const resolvedLink = await resolveGoogleNewsUrl(absLink);
          return { ...item, link: resolvedLink };
        })
      );
      for (const item of resolved) {
        if (existingUrls.has(item.link)) { results.skipped++; continue; }
        const [articleText, image_url] = await Promise.all([fetchArticleText(item.link), fetchOgImage(item.link)]);
        await insertArticle(articleText, item.link, image_url, item.pubDate);
      }
    } catch (e) {
      console.error(`[RSS 실패] ${source.source_name}:`, e);
      results.failed++;
    }
  }

  console.log(`[완료] created:${results.created} skipped:${results.skipped} failed:${results.failed}`);
  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
