// Supabase Edge Function — curate-v2 (큐레이션 개편판, 단계형 파이프라인)
// 기존 curate 는 그대로 두고 병행 배포. 안전을 위해 기본값은 "시험 실행(dry)" — 실제 저장은 live 를 명시해야 함.
//   POST {"live": true}                      → 정기 실행 (기사·소스상태·건너뜀 기록 저장, 알림 발송, 감사 호출)
//   POST {} 또는 {"dry": true, "max_ai": 6}  → 시험 실행 (저장 안 함, curation_logs 에 run_mode='dry' 로만 기록)
//   POST {"only_source": "더벨트"}           → 해당 소스만 실행
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runCuration } from "./lib/pipeline.ts";
import { sendAlert } from "./lib/alert.ts";
import { sendCompletionSummary } from "./lib/summary.ts";
import { previewSource } from "./lib/preview.ts";
import { classifyPending } from "./lib/classify.ts";
import type { PreviewInput } from "./lib/preview.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_CHAIN = Math.max(0, Number(Deno.env.get("CURATE_MAX_CHAIN") ?? 2));   // 시간 초과로 남은 후보를 이어서 처리하는 연속 실행의 최대 횟수 (처음 실행 + 이만큼)
const MAX_LIVE_RUNS_PER_DAY = 8;                                                   // 하루에 시작할 수 있는 정기·수동 실행(연속 실행 포함) 상한 — 폭주 방지
const MAX_CHAIN_MS = 15 * 60 * 1000;                                              // 연속 실행 전체가 이 시간을 넘기면 중단

Deno.serve(async (req) => {
  const reqStart = Date.now();
  if (req.method === "OPTIONS")
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });

  // 인증 — v1 과 달리 CRON_SECRET 이 설정돼 있지 않으면 거부 (비어 있으면 누구나 통과되던 구멍 제거)
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const ok = (!!cronSecret && (authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret)) || (!!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`);
  if (!ok) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 본문 없음 */ }

  // 발행 후 사업영역 판정 — 큐레이션이 끝나면 자동으로 호출되고, 직접 호출해서 시험할 수도 있음 ({"task":"classify_domains","dry":true})
  if (body.task === "classify_domains") {
    try {
      const r = await classifyPending({ supabase, env: (k) => Deno.env.get(k) }, { dry: body.dry === true, limit: Number(body.limit) || undefined, maxAgeDays: Number(body.max_age_days) || undefined });
      return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      console.error("[classify_domains 실패]", e);
      return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // 소스·키워드 추가 화면의 미리보기 — DB 에 아무것도 쓰지 않는 읽기 전용
  if (body.preview) {
    const result = await previewSource(body.preview as PreviewInput, {
      naverId: Deno.env.get("NAVER_CLIENT_ID"), naverSecret: Deno.env.get("NAVER_CLIENT_SECRET"), jinaKey: Deno.env.get("JINA_API_KEY"),
    });
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }
  const live = body.live === true || url.searchParams.get("live") === "1";
  const maxAi = Number(body.max_ai ?? url.searchParams.get("max_ai") ?? (live ? NaN : 6));
  const onlySource = (body.only_source as string | undefined) ?? url.searchParams.get("only_source") ?? undefined;
  const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
  const chain = Math.max(0, Number(body.chain) || 0);
  if (live && chain > MAX_CHAIN) return new Response(JSON.stringify({ ok: false, error: `연속 실행 상한(${MAX_CHAIN}회) 초과` }), { status: 400, headers: { "Content-Type": "application/json" } });
  // 하루 실행 횟수 상한 — 이어서 실행이 어떤 이유로든 반복되더라도 하루 8회를 넘지 못함
  if (live && chain > 0) {
    const kstNow = new Date(Date.now() + 9 * 3600000); kstNow.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase.from("curation_logs").select("id", { count: "exact", head: true }).eq("run_mode", "live").gte("run_at", new Date(kstNow.getTime() - 9 * 3600000).toISOString());
    if ((count ?? 0) >= MAX_LIVE_RUNS_PER_DAY) {
      await sendAlert(webhook, { title: "큐레이션 이어서 실행 중단 — 하루 실행 상한", description: `오늘 이미 ${count}회 실행해 이어서 처리하지 않습니다.`, level: "warning" });
      return new Response(JSON.stringify({ ok: false, error: "하루 실행 상한" }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
  }

  let result;
  try {
    result = await runCuration(
      { supabase, env: (k) => Deno.env.get(k) },
      { dry: !live, maxAi: Number.isFinite(maxAi) ? maxAi : undefined, onlySource, budgetMs: 120_000, chain, finalPass: chain >= MAX_CHAIN, trigger: typeof body.trigger === "string" ? body.trigger : undefined, stopAfter: !live && Number(body.stop_after) > 0 ? Number(body.stop_after) : undefined },
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[curate-v2 실패]", e);
    if (live) await sendAlert(webhook, { title: "큐레이션 실행 실패 (curate-v2)", description: msg, level: "error" });
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // 시간 초과로 남은 후보가 있으면 이어서 처리 — 아래 조건을 모두 통과할 때만 한 번 더 호출(무한 반복 방지 장치):
  //  ① 최대 MAX_CHAIN 회  ② 이번 회차에 실제로 처리한 후보가 있음  ③ 남은 후보 수가 지난 회차보다 줄었음
  //  ④ 같은 발행 창(예약 시각)  ⑤ 연속 실행 전체 15분 이내  ⑥ 하루 실행 횟수 상한(위)  ⑦ 앞 실행이 끝난 뒤에만 호출(겹침 없음, pipeline 의 "실행 중" 잠금)
  const r = result as { ok?: boolean; skipped?: boolean; deferred?: number; progress?: number; window_end?: number } | undefined;
  let willContinue = false;
  if (live && r?.ok && !r.skipped && (r.deferred ?? 0) > 0) {
    const prev = body.prev_deferred != null ? Number(body.prev_deferred) : Infinity;
    const stop: string[] = [];
    if (chain >= MAX_CHAIN) stop.push(`이어서 실행 최대 ${MAX_CHAIN}회`);
    if (!((r.progress ?? 0) > 0)) stop.push("이번 회차에 처리한 후보가 없음");
    if (!((r.deferred ?? 0) < prev)) stop.push("남은 후보가 줄지 않음");
    if (body.window_end != null && Number(body.window_end) !== Number(r.window_end)) stop.push("발행 창이 바뀜");
    if (Date.now() - (Number(body.chain_started) || reqStart) > MAX_CHAIN_MS) stop.push("연속 실행 15분 초과");
    if (stop.length === 0) {
      willContinue = true;
      const next = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/curate-v2`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ live: true, trigger: body.trigger, chain: chain + 1, prev_deferred: r.deferred, window_end: r.window_end, chain_started: Number(body.chain_started) || reqStart }),
        signal: AbortSignal.timeout(5000),   // 다음 회차가 시작되면 연결을 끊음 — 다음 회차는 독립적으로 계속 실행됨
      }).catch(() => { /* 5초 타임아웃은 정상 */ });
      // @ts-ignore Supabase Edge Runtime 전역
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(next);
    } else if (chain < MAX_CHAIN) {
      // 마지막 회차의 "시간 초과로 남은 후보" 경고는 pipeline 이 보냄. 그 전에 조건 때문에 멈추면 여기서 알림
      await sendAlert(webhook, { title: "큐레이션 이어서 실행 중단", description: `시간 초과로 ${r.deferred}건이 남았지만 이어서 처리하지 않았습니다: ${stop.join(", ")}`, level: "warning" });
    }
  }

  // 모든 회차가 끝났을 때(이어서 실행이 더 없을 때) 카테고리별 발행·대기 건수를 한 번 안내
  if (live && !willContinue && r?.ok && !r.skipped) {
    const summary = sendCompletionSummary(supabase, webhook, {
      chainStartedMs: Number(body.chain_started) || reqStart, trigger: typeof body.trigger === "string" ? body.trigger : undefined, chain, deferred: r.deferred ?? 0,
      window: (result as { window?: { start: string; end: string } } | undefined)?.window,
    });
    // @ts-ignore Supabase Edge Runtime 전역
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(summary); else await summary;
  }

  // 정기 실행이 끝나면 새로 발행된 콘텐츠를 백그라운드로 품질 감사 — 호출 자체가 실패하면 알림 (이어서 실행이 남았으면 마지막 회차에서)
  if (live && !willContinue && !(r?.skipped)) {
    try {
      const auditPromise = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/audit-content`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      }).then(async (res) => {
        if (!res.ok) await sendAlert(webhook, { title: "품질 감사 함수 호출 실패", description: `audit-content 응답 HTTP ${res.status}`, level: "error" });
      }).catch(async (e) => {
        console.error("[자동 감사 트리거 실패]", e);
        await sendAlert(webhook, { title: "품질 감사 함수 호출 실패", description: (e as Error).message, level: "error" });
      });
      // 발행이 끝난 뒤 사업영역을 채우는 작업 — 같은 함수를 별도 호출로 띄워 새 실행 시간(150초)을 받음
      const classifyPromise = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/curate-v2`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ task: "classify_domains" }),
      }).catch((e) => console.error("[사업영역 판정 호출 실패]", e));
      // @ts-ignore Supabase Edge Runtime 전역 — 응답 이후에도 백그라운드 작업이 계속되게 함
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) { EdgeRuntime.waitUntil(auditPromise); EdgeRuntime.waitUntil(classifyPromise); }
    } catch (e) {
      console.error("[자동 감사 연결 실패]", e);
    }
  }

  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
});
