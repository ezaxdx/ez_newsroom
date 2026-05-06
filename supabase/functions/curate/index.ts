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
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
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

/* ── OG 이미지 추출 (Edge Function 내 직접 구현) ── */
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    return og?.[1] ?? null;
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
    await supabase.from("gmail_tokens").update({
      access_token: json.access_token,
      expiry_date: Date.now() + (json.expires_in ?? 3600) * 1000,
      updated_at: new Date().toISOString(),
    }).eq("id", "singleton");
    return json.access_token;
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
// deno-lint-ignore no-explicit-any
function extractHtmlBody(payload: any): string {
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

  let accessToken = tokenRow.access_token;
  const isExpired = !accessToken || (tokenRow.expiry_date && Date.now() > tokenRow.expiry_date - 60000);
  if (isExpired) {
    accessToken = await refreshGmailToken(tokenRow.refresh_token);
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
      const detail = await detailRes.json();
      const headers = detail.payload?.headers ?? [];
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "(제목 없음)";
      const date = headers.find((h: { name: string }) => h.name === "Date")?.value ?? "";
      const htmlBody = extractHtmlBody(detail.payload);
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

/* ── Gemini 기사 생성 ── */
async function generateArticle(
  apiKey: string, articleText: string, url: string,
  persona: string, audience: string, keywords: string[],
  levelPrompts: Record<string, string>
): Promise<{ title: string; summary_short: string; content_long: string; implications: string; level: string; quality_score: number } | null> {
  const keywordHint = keywords.length ? `\n강조 키워드: ${keywords.join(", ")}` : "";
  const prompt = `${persona}
타겟 독자: ${audience}${keywordHint}

퀄리티 점수 기준 (1~10):
- 9~10: 업계 핵심 인사이트, 구체적 수치/사례 풍부, 즉시 실행 가능한 시사점
- 7~8: 관련성 높고 실용적, 부분적으로 구체적
- 5~6: 일반적 내용, 시사점이 다소 추상적
- 3~4: 관련성 낮거나 원문 접근 불가로 내용 빈약
- 1~2: 카테고리와 무관하거나 정보 없음

레벨 기준:
- Beginner: 전문 배경지식 없어도 이해 가능
- Intermediate: 업계 기본 지식 보유자 대상
- Advanced: 깊은 전문성 필요

[Beginner] ${levelPrompts["Beginner"] ?? "쉽고 명확하게 작성하세요."}
[Intermediate] ${levelPrompts["Intermediate"] ?? "실무 담당자 관점에서 작성하세요."}
[Advanced] ${levelPrompts["Advanced"] ?? "전략적 심층 분석으로 작성하세요."}

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
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const json = await res.json();
    if (!res.ok) { console.error("[Gemini error]", json); return null; }
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      ?.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "") ?? "";
    return JSON.parse(raw);
  } catch (e) {
    console.error("[Gemini error]", e);
    return null;
  }
}

/* ── 메인 핸들러 ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });

  const authHeader = req.headers.get("Authorization");
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`)
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY 없음" }), { status: 500 });

  const { data: sources } = await supabase.from("rss_sources").select("*").eq("is_active", true);
  if (!sources?.length) return new Response(JSON.stringify({ error: "활성 소스 없음" }), { status: 400 });

  const { data: settings } = await supabase
    .from("curation_settings").select("category_settings, level_prompts, quality_thresholds")
    .limit(1).single();
  const catSettings: Record<string, { audience: string; persona: string; keywords: string[] }> = settings?.category_settings ?? {};
  const allLevelPrompts: Record<string, Record<string, string>> = settings?.level_prompts ?? {};
  const qualityThresholds = settings?.quality_thresholds ?? { auto_publish: 8, staging: 5 };

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
      const generated = await generateArticle(apiKey, articleText, url, setting.persona, setting.audience, setting.keywords, catLevelPrompts);
      if (!generated) { results.failed++; return; }
      const score = generated.quality_score ?? 5;
      if (score < qualityThresholds.staging) { results.skipped++; existingUrls.add(url); return; }
      const shouldAutoPublish = score >= qualityThresholds.auto_publish;
      const { error } = await supabase.from("news").insert({
        title: generated.title, summary_short: generated.summary_short,
        content_long: generated.content_long, implications: generated.implications,
        level: generated.level ?? "Intermediate", image_url, original_url: url,
        category, quality_score: score, is_published: shouldAutoPublish,
        priority_score: source.weight * 10, display_order: 1000 - score * 10,
        published_at: shouldAutoPublish ? new Date().toISOString() : safeDateISO(pubDate),
      });
      if (error) { results.failed++; } else { results.created++; existingUrls.add(url); }
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
          if (existingUrls.has(item.link)) { results.skipped++; continue; }
          const isRef = item.link.startsWith("gmail:");
          const [articleText, image_url] = isRef
            ? ["", null]
            : await Promise.all([fetchArticleText(item.link), fetchOgImage(item.link)]);
          await insertArticle(articleText, isRef ? source.url : item.link, image_url, item.pubDate);
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
      for (const item of rssItems) {
        if (existingUrls.has(item.link)) { results.skipped++; continue; }
        const [articleText, image_url] = await Promise.all([fetchArticleText(item.link), fetchOgImage(item.link)]);
        await insertArticle(articleText, item.link, image_url, item.pubDate);
      }
    } catch (e) {
      console.error(`[RSS 실패] ${source.source_name}:`, e);
      results.failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
