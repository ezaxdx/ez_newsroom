import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not configured" }, { status: 500 });
  }

  // 클라이언트에서 이번 호 콘텐츠 context를 넘겨줄 수 있음
  let passedContext: { news_titles?: string[]; event_names?: string[] } | null = null;
  try {
    const body = await req.json();
    if (body?.context) passedContext = body.context;
  } catch {
    // body 없으면 무시
  }

  // 오늘 날짜 (KST)
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = nowKST.getUTCMonth() + 1;
  const day = nowKST.getUTCDate();

  let newsTitles: string;
  let eventNames: string;

  if (passedContext) {
    // 이번 호 실제 뉴스 제목 사용
    newsTitles = (passedContext.news_titles ?? []).join("\n") || "뉴스 정보 없음";
    eventNames = (passedContext.event_names ?? []).join(", ") || "";
  } else {
    // fallback: DB에서 최근 7일 뉴스 직접 조회
    const supabase = createAdminClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const { data: recentNews } = await supabase
      .from("news")
      .select("title, category")
      .eq("is_published", true)
      .gte("published_at", sevenDaysAgo)
      .order("published_at", { ascending: false })
      .limit(8);
    newsTitles = (recentNews ?? []).map((n) => `[${n.category}] ${n.title}`).join("\n") || "뉴스 정보 없음";
    eventNames = "";
  }

  const eventLine = eventNames
    ? `\n이번 주 주목할 행사: ${eventNames}`
    : "";

  const prompt = `MICE·관광 업계에서 일하는 실무자가 동료들에게 보내는 뉴스레터 인사말을 써줘.

오늘은 ${month}월 ${day}일이야.

이번 호 뉴스:
${newsTitles}${eventLine}

조건:
- 3~4문장, 70~110자 내외
- 실무자가 직접 쓴 것처럼 자연스럽고 편안한 말투
- 계절·날씨·${month}월의 업계 분위기를 자연스럽게 녹여줘
- 위 뉴스나 행사 중 하나를 구체적으로 언급해서 "이번 호에 담겨 있다"는 느낌을 살짝 줘도 좋아 (단, 내용 요약은 금지)
- AI·데이터·기술 관점 언급 금지
- "안녕하세요" 없이 바로 시작
- 마지막은 "오늘도 EZ하게 시작해볼까요?" 또는 같은 뉘앙스로 마무리
- 본문만 출력, 서명 없음`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    return NextResponse.json({ error: `Gemini API 오류: ${err}` }, { status: 500 });
  }

  const geminiJson = await geminiRes.json();
  const editorial =
    geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  if (!editorial) {
    return NextResponse.json({ error: "AI 응답이 비어있습니다." }, { status: 500 });
  }

  return NextResponse.json({ editorial });
}
