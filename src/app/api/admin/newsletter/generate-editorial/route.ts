import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_EDITORIAL_PROMPT, fillEditorialPrompt } from "@/lib/editorial-prompt";

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

  const { data: cfg } = await createAdminClient().from("newsletter_cron_settings").select("editorial_prompt").single();
  const prompt = fillEditorialPrompt((cfg?.editorial_prompt as string | null)?.trim() || DEFAULT_EDITORIAL_PROMPT, { month, day, news: newsTitles, events: eventNames });
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
