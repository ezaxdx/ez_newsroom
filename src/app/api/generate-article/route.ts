import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_PERSONA_PROMPTS: Record<string, string> = {
  AI: "당신은 AI·디지털 전환 전문 에디터입니다. MICE·관광 산업 종사자가 즉시 활용할 수 있는 실용적 시각으로 AI 기술 뉴스를 분석합니다.",
  MICE: "당신은 MICE 산업 전문 에디터입니다. 컨벤션·전시·이벤트 기획자 관점에서 운영 효율화와 참가자 경험 향상에 초점을 맞춥니다.",
  TOURISM: "당신은 관광·여행 산업 전문 에디터입니다. 지자체·OTA·숙박업 관계자가 활용할 수 있는 관광 트렌드와 전략적 시사점을 분석합니다.",
  EZPMP: "당신은 EZPMP(이즈피엠피)의 홍보 에디터입니다. EZPMP는 MICE·행사 기획 및 운영 솔루션을 제공하는 기업입니다. EZPMP의 서비스·실적·소식을 중심으로, 고객사와 파트너사 관점에서 신뢰감 있고 전문적인 기업 소식으로 작성합니다.",
};

const DEFAULT_LEVEL_PROMPTS: Record<string, string> = {
  Beginner: "【독자 수준: 입문】 업계 배경지식이 없는 독자를 위해 전문 용어는 쉽게 풀어 설명하고, 짧고 명확한 문장으로 작성하세요. 왜 중요한지를 일상적인 비유로 전달하세요.",
  Intermediate: "【독자 수준: 실무】 업계 기본 지식을 보유한 실무 담당자를 위해 업계 용어를 자연스럽게 사용하고, 현장에서 즉시 적용 가능한 관점으로 작성하세요.",
  Advanced: "【독자 수준: 전략】 전략·기획자를 위해 산업 구조 변화와 거시적 시사점을 심층 분석하세요. 데이터, 인과관계, 경쟁 구도 변화 중심으로 논리적으로 작성하세요.",
};

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { url, category, level, persona_override } = await req.json();

  if (!url || !category) {
    return NextResponse.json({ error: "url and category are required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not configured" }, { status: 500 });
  }

  // 네이버 블로그 URL → PostView.naver 변환
  function resolveNaverBlogUrl(u: string): string {
    const m = u.match(/(?:m\.)?blog\.naver\.com\/([^/?#]+)\/(\d+)/);
    if (!m) return u;
    return `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}&isRedirectFromMobile=true`;
  }
  const fetchUrl = resolveNaverBlogUrl(url);
  const isNaver = fetchUrl !== url;
  const fetchHeaders: Record<string, string> = isNaver
    ? {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://blog.naver.com/",
      }
    : { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" };

  // OG 이미지와 원문 병렬 fetch
  const ogImagePromise = fetch(
    `${req.nextUrl.origin}/api/og-image?url=${encodeURIComponent(url)}`
  )
    .then((r) => r.json())
    .then((d) => d.image as string | null)
    .catch(() => null);

  let articleText = "";
  try {
    const res = await fetch(fetchUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });

    // 인코딩 감지: EUC-KR 등 non-UTF-8 페이지 대응
    const contentType = res.headers.get("content-type") ?? "";
    const charsetMatch =
      contentType.match(/charset=["']?([\w-]+)/i);
    let charset = charsetMatch?.[1]?.toLowerCase() ?? "utf-8";
    // 한국 레거시 인코딩 정규화
    if (["euc-kr", "ks_c_5601-1987", "ks_c_5601", "cp949", "x-windows-949"].includes(charset)) {
      charset = "euc-kr";
    }

    let html: string;
    if (charset === "utf-8" || charset === "utf8") {
      html = await res.text();
    } else {
      // UTF-8 외 인코딩은 ArrayBuffer로 받아 TextDecoder로 디코딩
      const buffer = await res.arrayBuffer();
      try {
        html = new TextDecoder(charset).decode(buffer);
      } catch {
        // TextDecoder가 해당 charset을 모르면 UTF-8 fallback
        html = new TextDecoder("utf-8").decode(buffer);
      }
    }

    articleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);

    // 내용이 너무 짧거나 바이너리처럼 보이면 스크래핑 실패로 판단
    const printableRatio = (articleText.match(/[ -~가-힣぀-ヿ]/g) ?? []).length / (articleText.length || 1);
    if (articleText.length < 200 || printableRatio < 0.5) {
      return NextResponse.json(
        { error: "원문 내용을 읽을 수 없습니다. JavaScript 렌더링 페이지이거나 접근이 차단된 URL일 수 있습니다." },
        { status: 422 }
      );
    }
  } catch {
    return NextResponse.json({ error: "원문 페이지를 불러올 수 없습니다." }, { status: 422 });
  }

  // DB에서 curation_settings 읽기
  let personaPrompt = persona_override ?? DEFAULT_PERSONA_PROMPTS[category.toUpperCase()] ?? DEFAULT_PERSONA_PROMPTS.AI;
  let levelGuide = DEFAULT_LEVEL_PROMPTS[level] ?? DEFAULT_LEVEL_PROMPTS.Intermediate;
  let qualityThresholds = { auto_publish: 8, staging: 6 };

  try {
    const supabase = createAdminClient();
    const { data: settings } = await supabase
      .from("curation_settings")
      .select("category_settings, level_prompts, quality_thresholds, company_context")
      .limit(1)
      .single();

    if (settings) {
      if (!persona_override && settings.category_settings) {
        const catKey = category.toUpperCase();
        const catSettings = settings.category_settings[catKey] ?? settings.category_settings[category];
        if (catSettings?.persona) {
          personaPrompt = catSettings.persona;
        }
      }
      if (settings.level_prompts?.[level]) {
        levelGuide = settings.level_prompts[level];
      }
      if (settings.quality_thresholds) {
        qualityThresholds = settings.quality_thresholds;
      }
    }
  } catch {
    // DB 조회 실패 시 기본값 사용
  }

  const prompt = `${personaPrompt}
${levelGuide}

다음 기사를 분석해 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

{
  "quality_score": 8,
  "quality_criteria": {
    "relevance": 9,
    "specificity": 8,
    "practicality": 7,
    "source_quality": 8
  },
  "level": "Intermediate",
  "title": "제목(50자이내, 핵심 사실 중심, 명사형 또는 단문으로 끝낼 것 — '~입니다' 금지)",
  "summary_short": "요약(2~3문장, 120자이내, 반드시 합쇼체)",
  "content_long": "상세분석(4~6문장, 독자가 원문 없이도 이해할 수 있도록, 반드시 합쇼체)",
  "implications": "시사점(2~3문장, 실행 가능한 인사이트, 반드시 합쇼체)"
}

품질 점수 기준 (1~10점):
- relevance(관련성): MICE·관광·AI 업계 실무자에게 얼마나 직접 관련 있는지
- specificity(구체성): 수치·사례·타임라인 등 구체적 정보가 있는지
- practicality(실용성): 독자가 즉시 활용하거나 참고할 수 있는 내용인지
- source_quality(원문품질): 출처의 신뢰도와 정보의 완결성
- quality_score: 위 4개 항목의 종합 평균 (소수점 반올림)
- level: 기사 내용의 전문성 수준 ("Beginner" | "Intermediate" | "Advanced")
- 자동발행 기준: ${qualityThresholds.auto_publish}점 이상 / 대기열 기준: ${qualityThresholds.staging}점 이상

원문 URL: ${url}

원문 내용:
${articleText}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));

    // thinking 모델의 경우 parts 중 thought:true 가 아닌 첫 번째 텍스트 파트 사용
    const parts: Array<{ text?: string; thought?: boolean }> =
      json.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find((p) => !p.thought && typeof p.text === "string");
    const raw = (textPart?.text ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    if (!raw) throw new Error("빈 응답");
    const parsed = JSON.parse(raw);
    const image_url = await ogImagePromise;

    return NextResponse.json({
      title: parsed.title ?? "",
      summary_short: parsed.summary_short ?? "",
      content_long: parsed.content_long ?? "",
      implications: parsed.implications ?? "",
      quality_score: typeof parsed.quality_score === "number" ? parsed.quality_score : null,
      quality_criteria: parsed.quality_criteria ?? null,
      level: parsed.level ?? level ?? "Intermediate",
      image_url,
      original_url: url,
      category: category.toUpperCase(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-article] Gemini 오류:", msg);
    return NextResponse.json(
      { error: "AI 생성 중 오류가 발생했습니다.", detail: msg },
      { status: 500 }
    );
  }
}
