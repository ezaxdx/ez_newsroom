import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronAuth } from "@/lib/verify-cron";
import { calcLastScheduledRun } from "@/lib/schedule";
import { sendDiscordAlert } from "@/lib/discord-alert";

export const maxDuration = 10;

// 이 크론이 스케줄대로(화·목) 실제로 실행됐는지, 매일 도는 이 호출 자체로 감시함 —
// 별도 워치독 크론을 안 만드는 이유: Vercel Hobby 플랜 크론 슬롯이 제한적이라
// 기존 슬롯을 매일 실행으로 바꾸고 그 안에서 확인하는 쪽이 안전함(vercel.json 참고).
// "예정된 마지막 실행 시각 + 여유시간"이 지났는데 curation_logs에 그 이후 기록이
// 없으면 크론이 침묵 실패한 것 — 아무도 모르게 며칠씩 큐레이션이 안 도는 사고를 막기 위함
async function checkMissedRun(
  supabase: ReturnType<typeof createAdminClient>,
  schedule: { days: number[]; hour: number }
) {
  const GRACE_MS = 3 * 60 * 60 * 1000; // 3시간(Vercel 지연 1시간 + 실행시간 감안 여유)
  const lastRun = calcLastScheduledRun(schedule.days, schedule.hour ?? 9);
  if (Date.now() - lastRun.getTime() < GRACE_MS) return; // 아직 여유시간 이내 — 판단 보류

  const { count } = await supabase
    .from("curation_logs")
    .select("id", { count: "exact", head: true })
    .gte("run_at", lastRun.toISOString());
  if (count && count > 0) return; // 정상 실행됨

  await sendDiscordAlert({
    title: "큐레이션 자동 실행 누락 감지",
    description: `예정된 실행 시각(${lastRun.toISOString()}) 이후로 curation_logs에 기록이 없습니다. 크론이 실행되지 않았거나 실패했을 수 있습니다.`,
    level: "error",
  });
}

export async function GET(req: Request) {
  const unauth = verifyCronAuth(req);
  if (unauth) return unauth;

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

  if (schedule.days?.length > 0) {
    await checkMissedRun(supabase, schedule);
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
