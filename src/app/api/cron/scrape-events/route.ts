import { NextResponse } from "next/server";

export const maxDuration = 10;

/**
 * Vercel Cron: 1월 1일 + 7월 1일 09:00 KST (00:00 UTC) 자동 실행
 * 실제 스크래핑은 Supabase Edge Function에서 수행 (최대 150s)
 * 이 라우트는 트리거만 하고 즉시 리턴
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-events`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  try {
    // 8초 내 응답 없어도 Edge Function은 계속 실행됨
    await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cronSecret}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 타임아웃이어도 Edge Function은 실행 중 — 무시
  }

  return NextResponse.json({ ok: true, message: "행사 스크래핑 시작됨" });
}
