import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

export async function POST() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not configured" }, { status: 500 });
  }

  const supabase = createAdminClient();

  // 최근 7일 뉴스 제목 수집
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const { data: recentNews } = await supabase
    .from("news")
    .select("title, category")
    .eq("is_published", true)
    .gte("published_at", sevenDaysAgo)
    .order("published_at", { ascending: false })
    .limit(8);

  const newsTitles = (recentNews ?? [])
    .map((n) => `[${n.category}] ${n.title}`)
    .join("\n");

  // 오늘 날짜 (KST)
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = nowKST.getUTCMonth() + 1;
  const day = nowKST.getUTCDate();

  const prompt = `MICE·관광 업계에서 일하는 실무자가 동료들에게 보내는 뉴스레터 인사말을 써줘.

오늘은 ${month}월 ${day}일이야.

이번 주 주요 뉴스:
${newsTitles || "뉴스 정보 없음"}

조건:
- 3~4문장, 60~100자 내외
- 실무자가 직접 쓴 것처럼 자연스럽고 편안한 말투
- 계절·날씨·업계 분위기 중 하나를 가볍게 언급해도 좋음
- 뉴스 내용을 직접 요약하지 말고, 이번 주 업계 흐름을 느낌으로만 담을 것
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
