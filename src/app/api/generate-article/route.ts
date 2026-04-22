import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const PERSONA_PROMPTS: Record<string, string> = {
  AI: "당신은 AI·디지털 전환 전문 에디터입니다. MICE·관광 산업 종사자가 즉시 활용할 수 있는 실용적 시각으로 AI 기술 뉴스를 분석합니다.",
  MICE: "당신은 MICE 산업 전문 에디터입니다. 컨벤션·전시·이벤트 기획자 관점에서 운영 효율화와 참가자 경험 향상에 초점을 맞춥니다.",
  TOURISM: "당신은 관광·여행 산업 전문 에디터입니다. 지자체·OTA·숙박업 관계자가 활용할 수 있는 관광 트렌드와 전략적 시사점을 분석합니다.",
  STARTUP: "당신은 스타트업·벤처 전문 에디터입니다. 창업자와 투자자 관점에서 시장 기회와 리스크를 분석합니다.",
  POLICY: "당신은 정책·규제 전문 에디터입니다. 업계 종사자가 대응해야 할 규제 변화와 정책 시사점을 명확하게 전달합니다.",
  OPERATIONS: "당신은 운영·경영 전문 에디터입니다. 현장 관리자 관점에서 효율화 전략과 실행 방법론을 제시합니다.",
  INDUSTRY: "당신은 산업 분석 전문 에디터입니다. 거시적 산업 트렌드와 시장 구조 변화를 심층 분석합니다.",
};

export async function POST(req: NextRequest) {
  const { url, category, persona_override } = await req.json();

  if (!url || !category) {
    return NextResponse.json({ error: "url and category are required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not configured" }, { status: 500 });
  }

  // OG 이미지와 원문 병렬 fetch
  const ogImagePromise = fetch(
    `${req.nextUrl.origin}/api/og-image?url=${encodeURIComponent(url)}`
  )
    .then((r) => r.json())
    .then((d) => d.image as string | null)
    .catch(() => null);

  let articleText = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MonolithBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    articleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  } catch {
    return NextResponse.json({ error: "원문 페이지를 불러올 수 없습니다." }, { status: 422 });
  }

  const persona = persona_override ?? PERSONA_PROMPTS[category.toUpperCase()] ?? PERSONA_PROMPTS.AI;

  const prompt = `${persona}

다음 기사를 분석해 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

{
  "title": "한국어 제목 (50자 이내, 핵심만)",
  "summary_short": "한국어 요약 (2~3문장, 120자 이내)",
  "content_long": "한국어 상세 분석 (4~6문장, 독자가 원문 없이도 이해할 수 있도록)",
  "implications": "한국어 시사점 (2~3문장, 실행 가능한 인사이트)"
}

원문 URL: ${url}

원문 내용:
${articleText}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    const parsed = JSON.parse(raw);
    const image_url = await ogImagePromise;

    return NextResponse.json({
      title: parsed.title ?? "",
      summary_short: parsed.summary_short ?? "",
      content_long: parsed.content_long ?? "",
      implications: parsed.implications ?? "",
      image_url,
      original_url: url,
      category: category.toUpperCase(),
    });
  } catch (e) {
    console.error("generate-article error:", e);
    return NextResponse.json({ error: "AI 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
