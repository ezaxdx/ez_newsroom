import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

const PERSONA_PROMPTS: Record<string, string> = {
  AI: "당신은 AI·디지털 전환 전문 에디터입니다. MICE·관광 산업 종사자가 즉시 활용할 수 있는 실용적 시각으로 AI 기술 뉴스를 분석합니다.",
  MICE: "당신은 MICE 산업 전문 에디터입니다. 컨벤션·전시·이벤트 기획자 관점에서 운영 효율화와 참가자 경험 향상에 초점을 맞춥니다.",
  TOURISM: "당신은 관광·여행 산업 전문 에디터입니다. 지자체·OTA·숙박업 관계자가 활용할 수 있는 관광 트렌드와 전략적 시사점을 분석합니다.",
  STARTUP: "당신은 스타트업·벤처 전문 에디터입니다. 창업자와 투자자 관점에서 시장 기회와 리스크를 분석합니다.",
  POLICY: "당신은 정책·규제 전문 에디터입니다. 업계 종사자가 대응해야 할 규제 변화와 정책 시사점을 명확하게 전달합니다.",
  OPERATIONS: "당신은 운영·경영 전문 에디터입니다. 현장 관리자 관점에서 효율화 전략과 실행 방법론을 제시합니다.",
  INDUSTRY: "당신은 산업 분석 전문 에디터입니다. 거시적 산업 트렌드와 시장 구조 변화를 심층 분석합니다.",
};

const LEVEL_PROMPTS: Record<string, string> = {
  Beginner:
    "【독자 수준: 입문】 업계 배경지식이 없는 독자를 위해 전문 용어는 쉽게 풀어 설명하고, 짧고 명확한 문장으로 작성하세요. 왜 중요한지를 일상적인 비유로 전달하세요.",
  Intermediate:
    "【독자 수준: 실무】 업계 기본 지식을 보유한 실무 담당자를 위해 업계 용어를 자연스럽게 사용하고, 현장에서 즉시 적용 가능한 관점으로 작성하세요.",
  Advanced:
    "【독자 수준: 전략】 전략·기획자를 위해 산업 구조 변화와 거시적 시사점을 심층 분석하세요. 데이터, 인과관계, 경쟁 구도 변화 중심으로 논리적으로 작성하세요.",
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

  const persona = persona_override ?? PERSONA_PROMPTS[category.toUpperCase()] ?? PERSONA_PROMPTS.AI;
  const levelGuide = LEVEL_PROMPTS[level] ?? LEVEL_PROMPTS.Intermediate;

  const prompt = `${persona}
${levelGuide}

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
