import { NextResponse } from "next/server";

// Supabase Edge Function으로 위임 — 150초 실행 가능 (Supabase 무료 플랜)
// Vercel 함수는 단순 프록시 역할만 수행

export const maxDuration = 60;

export async function POST() {
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/curate`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  try {
    // fire-and-forget: Edge Function 응답을 기다리지 않고 즉시 반환
    // (150초 파이프라인 동안 Vercel 함수가 대기할 필요 없음)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55초 후 abort

    const res = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cronSecret}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    // AbortError = 55초 초과 → Edge Function은 백그라운드에서 계속 실행 중
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json({ ok: true, message: "큐레이션이 백그라운드에서 실행 중입니다." });
    }
    console.error("[run-curation proxy 오류]", e);
    return NextResponse.json({ error: "Edge Function 호출 실패" }, { status: 500 });
  }
}
