import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 10;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("curation_settings")
    .select("auto_schedule")
    .limit(1)
    .single();

  const schedule = data?.auto_schedule ?? { enabled: false, days: [], hour: 9 };

  if (!schedule.enabled) {
    return NextResponse.json({ skipped: "auto schedule disabled" });
  }

  // Vercel Hobby 플랜은 최대 1시간 지연 실행 → hour 체크 제거, day만 확인
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dayKST = nowKST.getUTCDay();

  if (!schedule.days.includes(dayKST)) {
    return NextResponse.json({ skipped: `not scheduled (day=${dayKST})` });
  }

  // Vercel Hobby cron이 지연·중복 호출되는 경우가 있어, 오늘(KST) 이미 실행된 기록이 있으면 건너뜀
  // (하루에 두 번 실행되어 기사가 이중으로 쌓이던 문제의 원인 — 반드시 필요한 안전장치)
  const todayStartKST = new Date(nowKST);
  todayStartKST.setUTCHours(0, 0, 0, 0);
  const todayStartUTC = new Date(todayStartKST.getTime() - 9 * 60 * 60 * 1000).toISOString();
  const { count: alreadyRanToday } = await supabase
    .from("curation_logs")
    .select("id", { count: "exact", head: true })
    .gte("run_at", todayStartUTC);
  if (alreadyRanToday && alreadyRanToday > 0) {
    return NextResponse.json({ skipped: `already ran today (day=${dayKST})` });
  }

  // Edge Function 호출 — await으로 요청 전송을 보장하되 8초 내 응답 없으면 포기
  // (Supabase Edge Function은 클라이언트 연결 끊겨도 계속 실행됨)
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/curate`;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  try {
    await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "X-Cron-Secret": process.env.CRON_SECRET ?? "",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 타임아웃 또는 연결 오류여도 Edge Function은 이미 실행 중 — 무시
  }

  return NextResponse.json({ ok: true, message: "큐레이션 시작됨" });
}
