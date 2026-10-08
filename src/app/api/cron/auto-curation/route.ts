import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronAuth } from "@/lib/verify-cron";
import { calcLastScheduledRun } from "@/lib/schedule";
import { sendDiscordAlert } from "@/lib/discord-alert";

export const maxDuration = 60;   // Edge 함수가 자원 한도 등으로 바로 죽으면(보통 30초 안) 그 응답을 받아 알리려고 기다림. 정상 실행은 2분 넘게 걸리므로 50초 안에 응답이 없으면 "실행 중"으로 보고 끝냄

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

  // 예정 시각 이후에 "끝난 정기·수동 실행(live, 완료)"이 없으면 누락 — 시험 실행(dry)과 도중에 죽은 실행("실행 중"·"실패")은 실행으로 치지 않음
  const { data: sinceLogs } = await supabase
    .from("curation_logs")
    .select("run_at, run_mode, details")
    .gte("run_at", lastRun.toISOString());
  const liveLogs = (sinceLogs ?? []).filter((l) => l.run_mode === "live");
  const done = liveLogs.some((l) => ((l.details as { status?: string } | null)?.status ?? "done") === "done");
  if (done) return; // 정상 실행됨
  const broken = liveLogs.filter((l) => ["running", "failed"].includes((l.details as { status?: string } | null)?.status ?? "")).length;
  await sendDiscordAlert({
    title: "큐레이션 자동 실행 누락 감지",
    description: broken > 0
      ? `예정된 실행 시각(${lastRun.toISOString()}) 이후로 끝난 실행이 없습니다. 시작은 했지만 끝나지 못한 실행 기록이 ${broken}건 있어 함수가 도중에 중단된 것으로 보입니다(자원 한도 등). 큐레이션 보드 하단 로그에서 "중단됨"을 확인하세요.`
      : `예정된 실행 시각(${lastRun.toISOString()}) 이후로 curation_logs에 실행 기록이 없습니다. 크론이 실행되지 않았거나 시작 전에 실패했을 수 있습니다.`,
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
  // 정기·수동 실행(live)이 오늘 끝났거나, 10분 안에 시작해 아직 도는 중이면 건너뜀. 시험 실행(dry)과 도중에 죽은 실행(10분 넘게 "실행 중"·"실패")은 세지 않음 — 그래야 죽은 실행 때문에 정기 실행이 영영 막히지 않음
  const { data: todayLogs } = await supabase
    .from("curation_logs")
    .select("run_at, run_mode, details")
    .gte("run_at", todayStartUTC);
  const alreadyRan = (todayLogs ?? []).some((l) => {
    if (l.run_mode !== "live") return false;
    const status = (l.details as { status?: string } | null)?.status ?? "done";   // 상태 기록이 생기기 전의 옛 기록은 완료로 봄
    if (status === "done") return true;
    return status === "running" && Date.now() - new Date(l.run_at).getTime() < 10 * 60 * 1000;
  });
  if (alreadyRan) {
    return NextResponse.json({ skipped: `already ran today (day=${dayKST})` });
  }
  // Edge Function 호출 — await으로 요청 전송을 보장하되 8초 내 응답 없으면 포기
  // (Supabase Edge Function은 클라이언트 연결 끊겨도 계속 실행됨)
  // curate-v2 는 기본이 시험 실행(저장 안 함) — 정기 실행은 live: true 를 명시
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/curate-v2`;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  try {
    const res = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "X-Cron-Secret": process.env.CRON_SECRET ?? "",
      },
      body: JSON.stringify({ live: true, trigger: "cron" }),
      signal: AbortSignal.timeout(50000),
    });
    // 보통 실행은 2분 넘게 걸려 여기까지 응답이 오지 않음(아래 catch 의 타임아웃). 50초 안에 응답이 왔다면 거의 실패 — 알림
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      await sendDiscordAlert({ title: "정기 큐레이션 실행 실패", description: `curate-v2 가 HTTP ${res.status} 로 응답했습니다. ${body}`, level: "error" });
      return NextResponse.json({ ok: false, status: res.status, message: "큐레이션 시작 실패" }, { status: 502 });
    }
  } catch {
    // 50초 안에 응답이 없으면 Edge Function 이 정상적으로 계속 실행 중(클라이언트 연결이 끊겨도 계속 실행됨) — 무시
  }

  return NextResponse.json({ ok: true, message: "큐레이션 시작됨" });
}
