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
    .from("news_items")
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

  const prompt = `당신은 MICE·관광·AI 업계 뉴스레터 'EZ Letter'의 에디터입니다.

오늘은 ${month}월 ${day}일입니다.

이번 주 주요 뉴스 목록:
${newsTitles || "뉴스 정보 없음"}

위 뉴스들을 바탕으로 이번 주 뉴스레터 에디터 인사말을 작성해주세요.

조건:
- 3~4문장, 총 60~100자 내외
- 이번 주 업계 분위기나 트렌드를 자연스럽게 녹여낼 것
- 딱딱하지 않고 따뜻하고 친근한 말투
- "안녕하세요" 같은 형식적 인사 없이 바로 내용으로 시작
- 마지막 문장은 "오늘도 EZ하게 시작해볼까요?" 또는 비슷한 뉘앙스로 마무리
- 서명이나 이름 없이 본문만 출력`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 1024 },
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
