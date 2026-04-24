import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
): Promise<{ title: string; summary_short: string; content_long: string; implications: string; level: string } | null> {
  const keywordHint = keywords.length ? `\n강조 키워드: ${keywords.join(", ")}` : "";
  const levelGuide = `
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
    .select("category_settings, level_prompts")
    .limit(1)
    .single();
  const catSettings: Record<string, { audience: string; persona: string; keywords: string[] }> =
    settings?.category_settings ?? {};
  // 카테고리별 레벨 프롬프트: { AI: {초급:..., 중급:..., 고급:...}, MICE: {...} }
  const allLevelPrompts: Record<string, Record<string, string>> = settings?.level_prompts ?? {};

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

      const { error } = await supabase.from("news").insert({
        title: generated.title,
        summary_short: generated.summary_short,
        content_long: generated.content_long,
        implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url,
        original_url: source.url,
        category,
        is_published: false,
        priority_score: source.weight * 10,
        display_order: 999,
        published_at: new Date().toISOString(),
      });

      if (error) { results.failed++; } else {
        results.created++;
        existingUrls.add(source.url);
      }
      continue;
    }

    /* ── RSS 피드 소스 ── */
    let rssItems: { title: string; link: string; pubDate: string }[] = [];
    try {
      const res = await fetch(source.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      const xml = await res.text();
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

      const { error } = await supabase.from("news").insert({
        title: generated.title,
        summary_short: generated.summary_short,
        content_long: generated.content_long,
        implications: generated.implications,
        level: generated.level ?? "Intermediate",
        image_url,
        original_url: item.link,
        category,
        is_published: false,
        priority_score: source.weight * 10,
        display_order: 999,
        published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      });

      if (error) { results.failed++; } else {
        results.created++;
        existingUrls.add(item.link);
      }
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
