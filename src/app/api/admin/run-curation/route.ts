import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { google } from "googleapis";
import type { ApiConfig, GmailConfig } from "@/lib/types";

export const maxDuration = 60; // Pro: 60s / Hobby: 10s (최대치 요청)

/* ── RSS XML 인코딩 감지 후 텍스트 변환 ── */
async function fetchRssText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
    signal: AbortSignal.timeout(8000),
  });
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // XML 선언부 또는 Content-Type 헤더에서 인코딩 감지
  const sniff = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200));
  const encMatch = sniff.match(/encoding=["']([^"']+)["']/i)
    ?? res.headers.get("content-type")?.match(/charset=([^\s;]+)/i);
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
    const title = extractCDATA(
      c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    );
    const link = extractCDATA(
      c.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ??
      c.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? ""
    );
    const pubDate = c.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ?? "";
    if (title && link) items.push({ title, link, pubDate });
  }
  return items.slice(0, 3); // 소스당 최대 3개
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

/* ── 날짜 문자열 안전 파싱 ── */
function safeDateISO(raw: string | undefined | null): string {
  if (!raw) return new Date().toISOString();
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/* ── 공공 API 데이터 fetch & 텍스트 변환 ── */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function autoBaseYm(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // 전월
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

async function fetchApiData(
  baseUrl: string,
  config: ApiConfig
): Promise<{ text: string; articleUrl: string } | null> {
  try {
    const serviceKey = process.env[config.service_key_env];
    if (!serviceKey) {
      console.error(`[API] 환경변수 없음: ${config.service_key_env}`);
      return null;
    }

    const params = new URLSearchParams();
    params.set("serviceKey", serviceKey);
    for (const [k, v] of Object.entries(config.params)) {
      params.set(k, v === "auto" && k === "baseYm" ? autoBaseYm() : v);
    }

    const fullUrl = `${baseUrl}${config.endpoint}?${params.toString()}`;
    console.log(`[API 요청] ${baseUrl}${config.endpoint}`);

    const res = await fetch(fullUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[API 오류] ${res.status} ${res.statusText}`);
      return null;
    }

    const json = await res.json();
    const items = getNestedValue(json, config.data_path);
    const arr = Array.isArray(items) ? items : items ? [items] : [];

    if (!arr.length) {
      console.warn(`[API] 데이터 없음 (경로: ${config.data_path})`);
      return null;
    }

    // 데이터를 가독성 있는 텍스트로 변환
    const baseYm = config.params["baseYm"] === "auto" ? autoBaseYm() : (config.params["baseYm"] ?? "");
    const header = `[${config.context_hint}] 기준연월: ${baseYm}\n\n`;
    const rows = arr.slice(0, 20).map((item, i) => {
      if (typeof item !== "object" || !item) return "";
      const fields = Object.entries(item as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
      return `${i + 1}. ${fields}`;
    }).join("\n");

    return {
      text: (header + rows).slice(0, 6000),
      articleUrl: `${baseUrl}${config.endpoint}`,
    };
  } catch (e) {
    console.error("[API fetch 실패]", e);
    return null;
  }
}

/* ── Gmail 뉴스레터 수집 ── */
async function fetchGmailNewsletters(
  config: GmailConfig
): Promise<{ title: string; link: string; pubDate: string }[]> {
  const supabase = createAdminClient();
  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expiry_date")
    .eq("id", "singleton")
    .single();

  if (!tokenRow?.refresh_token) {
    console.error("[Gmail] 저장된 토큰 없음. /admin/gmail 에서 인증하세요.");
    return [];
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date,
  });

  // 토큰 갱신 시 Supabase에 저장
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await supabase.from("gmail_tokens").update({
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date,
        updated_at: new Date().toISOString(),
      }).eq("id", "singleton");
    }
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // 발신자 + 제목 필터로 검색 (최근 7일)
  const query = [
    `from:${config.sender_filter}`,
    config.subject_filter ? `subject:${config.subject_filter}` : "",
    "newer_than:7d",
  ].filter(Boolean).join(" ");

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: config.max_emails ?? 3,
  });

  const messages = listRes.data.messages ?? [];
  const results: { title: string; link: string; pubDate: string }[] = [];

  for (const msg of messages) {
    try {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "full",
      });

      const headers = detail.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(제목 없음)";
      const date = headers.find((h) => h.name === "Date")?.value ?? "";

      // HTML 파트에서 본문 추출
      const htmlBody = extractHtmlBody(detail.data.payload);
      if (!htmlBody) continue;

      // 이메일 HTML에서 기사 링크 추출
      const articleLinks = extractArticleLinks(htmlBody, config.sender_filter);

      if (articleLinks.length === 0) {
        // 링크 없으면 이메일 자체를 단일 기사로 처리
        results.push({ title: subject, link: `gmail:${msg.id}`, pubDate: date });
      } else {
        for (const link of articleLinks.slice(0, 3)) {
          results.push({ title: link.title || subject, link: link.url, pubDate: date });
        }
      }
    } catch (e) {
      console.error("[Gmail 메시지 파싱 오류]", e);
    }
  }

  return results;
}

function extractHtmlBody(payload: import("googleapis").gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  // multipart인 경우 재귀 탐색
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = extractHtmlBody(part);
      if (found) return found;
    }
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  return "";
}

function extractArticleLinks(html: string, senderDomain: string): { title: string; url: string }[] {
  // 발신자 도메인에서 핵심 도메인 추출 (예: "noreply@yozm.wishket.com" → "wishket.com")
  const domainParts = senderDomain.split("@")[1]?.split(".") ?? [];
  const coreDomain = domainParts.slice(-2).join(".");

  const results: { title: string; url: string }[] = [];
  const seen = new Set<string>();

  // <a href="...">텍스트</a> 패턴 추출
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1];
    const rawTitle = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    // 구독 취소, 추적 링크 등 제외
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

/* ── OG 이미지 추출 ── */
async function fetchOgImage(url: string, origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/api/og-image?url=${encodeURIComponent(url)}`);
    const d = await res.json();
    return d.image ?? null;
  } catch {
    return null;
  }
}

/* ── Gemini 생성 ── */
async function generateArticle(
  apiKey: string,
  articleText: string,
  url: string,
  persona: string,
  audience: string,
  keywords: string[],
  levelPrompts: Record<string, string>
): Promise<{ title: string; summary_short: string; content_long: string; implications: string; level: string; quality_score: number } | null> {
  const keywordHint = keywords.length ? `\n강조 키워드: ${keywords.join(", ")}` : "";
  const levelGuide = `
퀄리티 점수 기준 (1~10):
- 9~10: 업계 핵심 인사이트, 구체적 수치/사례 풍부, 즉시 실행 가능한 시사점
- 7~8: 관련성 높고 실용적, 부분적으로 구체적
- 5~6: 일반적 내용, 시사점이 다소 추상적
- 3~4: 관련성 낮거나 원문 접근 불가로 내용 빈약
- 1~2: 카테고리와 무관하거나 정보 없음

먼저 아래 기사의 복잡도와 필요한 배경지식 수준을 판단해 레벨을 결정하세요:
- Beginner: 전문 배경지식 없어도 이해 가능한 일반적 내용
- Intermediate: 업계 기본 지식 보유자를 위한 실무 관련 내용
- Advanced: 깊은 전문성이 필요한 기술적·전략적 심층 분석

레벨별 작성 지침:
[Beginner] ${levelPrompts["Beginner"] ?? "쉽고 명확하게 작성하세요."}
[Intermediate] ${levelPrompts["Intermediate"] ?? "실무 담당자 관점에서 작성하세요."}
[Advanced] ${levelPrompts["Advanced"] ?? "전략적 심층 분석으로 작성하세요."}

결정한 레벨의 지침에 따라 기사를 작성하고, level 필드에 해당 레벨을 명시하세요.`;

  const prompt = `${persona}
타겟 독자: ${audience}${keywordHint}
${levelGuide}

다음 기사를 분석해 JSON으로만 응답하세요 (마크다운 없이):
{
  "quality_score": 퀄리티 점수 1~10 (기사 관련성·구체성·시사점 실용성·원문 충실도 종합),
  "level": "Beginner 또는 Intermediate 또는 Advanced",
  "title": "한국어 제목 (50자 이내)",
  "summary_short": "한국어 요약 (2~3문장, 120자 이내)",
  "content_long": "한국어 상세 분석 (4~6문장)",
  "implications": "한국어 시사점 (2~3문장, 실행 가능한 인사이트)"
}

원문 URL: ${url}
${articleText.length > 50 ? `원문:\n${articleText}` : "(원문 접근 불가 — 제목과 URL을 바탕으로 작성해주세요)"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const json = await res.json();
    if (!res.ok) {
      console.error("[generateArticle error]", json);
      return null;
    }
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      ?.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "") ?? "";
    return JSON.parse(raw);
  } catch (e) {
    console.error("[generateArticle error]", e);
    return null;
  }
}

/* ── 메인 핸들러 ── */
export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_AI_API_KEY not configured" }, { status: 500 });

  const origin = new URL(req.url).origin;
  const supabase = createAdminClient();

  // 1. 활성 RSS 소스 조회
  const { data: sources } = await supabase
    .from("rss_sources")
    .select("*")
    .eq("is_active", true);
  if (!sources?.length) return NextResponse.json({ error: "활성 RSS 소스가 없습니다." }, { status: 400 });

  // 2. 카테고리별 큐레이션 설정 + 레벨 프롬프트 조회
  const { data: settings } = await supabase
    .from("curation_settings")
    .select("category_settings, level_prompts, quality_thresholds")
    .limit(1)
    .single();
  const catSettings: Record<string, { audience: string; persona: string; keywords: string[] }> =
    settings?.category_settings ?? {};
  // 카테고리별 레벨 프롬프트: { AI: {초급:..., 중급:..., 고급:...}, MICE: {...} }
  const allLevelPrompts: Record<string, Record<string, string>> = settings?.level_prompts ?? {};
  const qualityThresholds: { auto_publish: number; staging: number } =
    settings?.quality_thresholds ?? { auto_publish: 8, staging: 5 };

  // 2-1. 이전 대기열 기사 삭제 (is_published=false인 기사)
  await supabase.from("news").delete().eq("is_published", false);

  // 3. 기존 기사 URL 목록 (중복 방지)
  const { data: existingNews } = await supabase.from("news").select("original_url");
  const existingUrls = new Set((existingNews ?? []).map((n) => n.original_url));

  const results = { created: 0, skipped: 0, failed: 0 };

  // 4. 소스별 처리
  for (const source of sources) {
    const category = source.default_category.toUpperCase();
    const setting = catSettings[category] ?? {
      audience: "MICE·관광 업계 종사자",
      persona: `당신은 ${category} 전문 에디터입니다. 업계 종사자 관점에서 핵심 시사점을 분석합니다.`,
      keywords: [],
    };
    const catLevelPrompts = allLevelPrompts[category] ?? {};

    /* ── 직접 URL 소스 ── */
    if (source.source_type === "url") {
      if (existingUrls.has(source.url)) { results.skipped++; continue; }

      const [articleText, image_url] = await Promise.all([
        fetchArticleText(source.url),
        fetchOgImage(source.url, origin),
      ]);

      console.log(`[URL 생성 시도] ${source.source_name} (텍스트 ${articleText.length}자)`);

      const generated = await generateArticle(
        apiKey, articleText, source.url,
        setting.persona, setting.audience, setting.keywords, catLevelPrompts
      );

      if (!generated) { results.failed++; continue; }

      const score = generated.quality_score ?? 5;

      // 퀄리티 미달 → 삽입 안 함
      if (score < qualityThresholds.staging) {
        console.log(`[퀄리티 미달 스킵] score=${score}`);
        results.skipped++;
        existingUrls.add(source.url);
        continue;
      }

      const shouldAutoPublish = score >= qualityThresholds.auto_publish;

      const { error } = await supabase.from("news").insert({
        title: generated.title,
        summary_short: generated.summary_short,
        content_long: generated.content_long,
        implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url,
        original_url: source.url,
        category,
        quality_score: score,
        is_published: shouldAutoPublish,
        priority_score: source.weight * 10,
        display_order: 1000 - score * 10,
        published_at: shouldAutoPublish ? new Date().toISOString() : new Date().toISOString(),
      });

      if (error) { results.failed++; } else {
        results.created++;
        existingUrls.add(source.url);
      }
      continue;
    }

    /* ── 공공 API 소스 ── */
    if (source.source_type === "api") {
      const cfg = source.api_config;
      if (!cfg?.endpoint) { results.skipped++; continue; }

      const apiResult = await fetchApiData(source.url, cfg);
      if (!apiResult) { results.failed++; continue; }

      const { text: articleText, articleUrl } = apiResult;

      // API 소스는 기준연월 기반으로 중복 체크 (같은 URL은 한 번만)
      if (existingUrls.has(articleUrl)) { results.skipped++; continue; }

      console.log(`[API 생성 시도] ${source.source_name} (텍스트 ${articleText.length}자)`);

      const generated = await generateArticle(
        apiKey, articleText, articleUrl,
        setting.persona, setting.audience, setting.keywords, catLevelPrompts
      );

      if (!generated) { results.failed++; continue; }

      const score = generated.quality_score ?? 5;

      if (score < qualityThresholds.staging) {
        console.log(`[퀄리티 미달 스킵] score=${score}`);
        results.skipped++;
        existingUrls.add(articleUrl);
        continue;
      }

      const shouldAutoPublish = score >= qualityThresholds.auto_publish;

      const { error } = await supabase.from("news").insert({
        title: generated.title,
        summary_short: generated.summary_short,
        content_long: generated.content_long,
        implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url: null,
        original_url: articleUrl,
        category,
        quality_score: score,
        is_published: shouldAutoPublish,
        priority_score: source.weight * 10,
        display_order: 1000 - score * 10,
        published_at: new Date().toISOString(),
      });

      if (error) { results.failed++; } else {
        results.created++;
        existingUrls.add(articleUrl);
      }
      continue;
    }

    /* ── Gmail 뉴스레터 소스 ── */
    if (source.source_type === "gmail") {
      const cfg = source.api_config as GmailConfig | null;
      if (!cfg?.sender_filter) { results.skipped++; continue; }

      let gmailItems: { title: string; link: string; pubDate: string }[] = [];
      try {
        gmailItems = await fetchGmailNewsletters(cfg);
        console.log(`[Gmail] ${source.source_name}: ${gmailItems.length}개 수집됨`);
      } catch (e) {
        console.error(`[Gmail 실패] ${source.source_name}:`, e);
        results.failed++;
        continue;
      }

      for (const item of gmailItems) {
        if (existingUrls.has(item.link)) { results.skipped++; continue; }

        // gmail: 접두사 링크는 이메일 직접 참조 — 원문 fetch 불가
        const isGmailRef = item.link.startsWith("gmail:");
        const [articleText, image_url] = isGmailRef
          ? ["", null]
          : await Promise.all([fetchArticleText(item.link), fetchOgImage(item.link, origin)]);

        const generated = await generateArticle(
          apiKey, articleText, isGmailRef ? source.url : item.link,
          setting.persona, setting.audience, setting.keywords, catLevelPrompts
        );

        if (!generated) { results.failed++; continue; }

        const score = generated.quality_score ?? 5;
        if (score < qualityThresholds.staging) {
          results.skipped++;
          existingUrls.add(item.link);
          continue;
        }

        const shouldAutoPublish = score >= qualityThresholds.auto_publish;
        const { error } = await supabase.from("news").insert({
          title: generated.title,
          summary_short: generated.summary_short,
          content_long: generated.content_long,
          implications: generated.implications,
          level: generated.level ?? "Intermediate",
          image_url,
          original_url: isGmailRef ? source.url : item.link,
          category,
          quality_score: score,
          is_published: shouldAutoPublish,
          priority_score: source.weight * 10,
          display_order: 1000 - score * 10,
          published_at: new Date().toISOString(),
        });

        if (error) { results.failed++; } else {
          results.created++;
          existingUrls.add(item.link);
        }
      }
      continue;
    }

    /* ── RSS 피드 소스 ── */
    let rssItems: { title: string; link: string; pubDate: string }[] = [];
    try {
      const xml = await fetchRssText(source.url);
      rssItems = parseRSS(xml);
      console.log(`[RSS] ${source.source_name}: ${rssItems.length}개 파싱됨`);
    } catch (e) {
      console.error(`[RSS 실패] ${source.source_name}:`, e);
      results.failed++;
      continue;
    }

    // 아이템별 처리
    for (const item of rssItems) {
      if (existingUrls.has(item.link)) { results.skipped++; continue; }

      const [articleText, image_url] = await Promise.all([
        fetchArticleText(item.link),
        fetchOgImage(item.link, origin),
      ]);

      console.log(`[생성 시도] ${item.title.slice(0, 40)}... (텍스트 ${articleText.length}자)`);

      const generated = await generateArticle(
        apiKey, articleText, item.link,
        setting.persona, setting.audience, setting.keywords, catLevelPrompts
      );

      if (!generated) { results.failed++; continue; }

      const score = generated.quality_score ?? 5;

      // 퀄리티 미달 → 삽입 안 함
      if (score < qualityThresholds.staging) {
        console.log(`[퀄리티 미달 스킵] score=${score}`);
        results.skipped++;
        existingUrls.add(item.link);
        continue;
      }

      const shouldAutoPublish = score >= qualityThresholds.auto_publish;

      const { error } = await supabase.from("news").insert({
        title: generated.title,
        summary_short: generated.summary_short,
        content_long: generated.content_long,
        implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url,
        original_url: item.link,
        category,
        quality_score: score,
        is_published: shouldAutoPublish,
        priority_score: source.weight * 10,
        display_order: 1000 - score * 10,
        published_at: shouldAutoPublish ? new Date().toISOString() : safeDateISO(item.pubDate),
      });

      if (error) { results.failed++; } else {
        results.created++;
        existingUrls.add(item.link);
      }
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
