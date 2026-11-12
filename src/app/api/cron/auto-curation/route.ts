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

  const edition = lastRun.toISOString();
  const [logsResult, batchResult] = await Promise.all([
    supabase.from("curation_logs").select("run_at, run_mode, details, errors")
      .eq("run_mode", "live").gte("run_at", edition).order("run_at", { ascending: false }),
    supabase.from("curation_batches").select("id, status, collection_attempts, processing_attempts, phase:snapshot->>phase, retry_blocked_reason, dispatch_error")
      .eq("window_end", edition).limit(1),
  ]);
  // A failed query is not evidence of a missing run.
  if (logsResult.error || batchResult.error) {
    console.error("[curation-watch] 조회 실패", logsResult.error ?? batchResult.error);
    return;
  }
  const batch = batchResult.data?.[0];
  const logs = (logsResult.data ?? []).filter(l => {
    const detail = l.details as { batch_id?: string } | null;
    return !detail?.batch_id || detail.batch_id === batch?.id;
  });
  if (batch?.status === "done" || logs.some(l =>
    ((l.details as { status?: string } | null)?.status ?? "done") === "done")) return;

  const processing = batch?.phase === "selected";
  const attempts = processing ? batch?.processing_attempts : batch?.collection_attempts;
  const state = batch?.retry_blocked_reason ? "blocked" : (attempts ?? 0) >= 8 ? "limit"
    : batch || logs.length ? "incomplete" : "missing";
  const cause = state === "blocked" ? "DB 오류로 자동 재시도를 중지했습니다."
    : state === "limit" ? `${processing ? "기사 처리" : "목록 수집"} 단계의 실행 상한(8회)에 도달했습니다.`
    : state === "incomplete" ? "작업 접수 또는 시작 기록은 있지만 완료 기록이 없습니다."
    : "이 회차의 작업 접수·실행 기록이 없습니다. 시작 요청 누락 또는 접수 전 실패 가능성이 있습니다.";
  const action = state === "blocked" ? "발행 DB 오류를 수정한 뒤 해당 회차의 재시도 중지 상태를 해제해야 합니다."
    : state === "limit" ? "실행 로그에서 반복 실패 원인을 확인한 뒤 재개 여부를 결정해야 합니다. 새 회차의 실행 한도는 별도입니다."
    : state === "incomplete" ? "실행 로그와 자동 복구 기록에서 중단 원인·잔여 후보를 확인해 주세요."
    : "Vercel 크론 호출 기록과 curate-v2 접수 응답·인증 설정을 확인해 주세요.";
  const errors = logs[0]?.errors as { error?: string }[] | null;
  const error = batch?.retry_blocked_reason ?? batch?.dispatch_error ?? errors?.[0]?.error;
  const queue = (logs[0]?.details as { queue?: { prepared?: number; pending?: number; failed?: number } } | null)?.queue;
  const target = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "full", timeStyle: "short" }).format(lastRun);
  const key = edition + ":" + state;
  const claim = await supabase.rpc("claim_curation_notification", { p_key: key });
  if (claim.error) { console.error("[curation-watch] 알림 접수 실패", claim.error); return; }
  if (!claim.data) return;
  const sent = await sendDiscordAlert({
    title: "큐레이션 자동 실행 누락 감지",
    description: ["대상 회차: " + target + " (한국시간)", cause,
      batch ? `목록 수집 ${batch.collection_attempts}/8회 · 기사 처리 ${batch.processing_attempts}/8회` : "",
      queue ? `최종 발행 전: 작성 완료 ${queue.prepared ?? 0}건 / 미처리 ${queue.pending ?? 0}건 / 개별 실패 ${queue.failed ?? 0}건` : "",
      error ? "기록된 오류: " + String(error).slice(0, 600) : "",
      "조치: " + action,
      "화·목 발행 회차를 매일 점검한 결과입니다. 같은 회차·상태는 중복 전송하지 않습니다. 수동 등록 기사 유무와는 별개입니다."
    ].filter(Boolean).join("\n"),
    level: "error",
  });
  const notification = supabase.from("curation_notifications");
  const result = sent
    ? await notification.update({ sent_at: new Date().toISOString() }).eq("notification_key", key).eq("claim_token", claim.data)
    : await notification.delete().eq("notification_key", key).eq("claim_token", claim.data);
  if (result.error) console.error("[curation-watch] 전송 결과 저장 실패", result.error);

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
    .gte("run_at", new Date(Math.max(Date.parse(todayStartUTC), calcLastScheduledRun(schedule.days, schedule.hour ?? 9).getTime())).toISOString());
  const alreadyRan = (todayLogs ?? []).some((l) => {
    if (l.run_mode !== "live") return false;
    const status = (l.details as { status?: string } | null)?.status ?? "done";   // 상태 기록이 생기기 전의 옛 기록은 완료로 봄
    if (status === "done") return true;
    return status === "running" && Date.now() - new Date(l.run_at).getTime() < 10 * 60 * 1000;
  });
  if (alreadyRan) {
    return NextResponse.json({ skipped: `already ran today (day=${dayKST})` });
  }
  // Edge Function이 DB 작업 접수 후 202를 반환하는지 확인한다.
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
      signal: AbortSignal.timeout(15000),
    });
    // 접수 실패를 정상 실행으로 숨기지 않는다.
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      await sendDiscordAlert({ title: "정기 큐레이션 실행 실패", description: `curate-v2 가 HTTP ${res.status} 로 응답했습니다. ${body}`, level: "error" });
      return NextResponse.json({ ok: false, status: res.status, message: "큐레이션 시작 실패" }, { status: 502 });
    }
    const accepted = await res.json();
    if (accepted.skipped) return NextResponse.json(accepted);
    if (res.status !== 202 || !accepted.batch_id) throw new Error("작업 접수 응답이 올바르지 않습니다.");
  } catch (e) {
    await sendDiscordAlert({ title: "정기 큐레이션 접수 확인 실패", description: (e as Error).message, level: "error" });
    return NextResponse.json({ ok: false, message: "큐레이션 접수를 확인하지 못했습니다." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: "큐레이션 시작됨" });
}
