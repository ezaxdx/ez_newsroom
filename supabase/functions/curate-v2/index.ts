// Supabase Edge Function — curate-v2 (큐레이션 개편판, 단계형 파이프라인)
// 기존 curate 는 그대로 두고 병행 배포. 안전을 위해 기본값은 "시험 실행(dry)" — 실제 저장은 live 를 명시해야 함.
//   POST {"live": true}                      → 정기 실행 (기사·소스상태·건너뜀 기록 저장, 알림 발송, 감사 호출)
//   POST {} 또는 {"dry": true, "max_ai": 6}  → 시험 실행 (저장 안 함, curation_logs 에 run_mode='dry' 로만 기록)
//   POST {"only_source": "더벨트"}           → 해당 소스만 실행
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runCuration } from "./lib/pipeline.ts";
import { sendAlert } from "./lib/alert.ts";
import { previewSource } from "./lib/preview.ts";
import { classifyPending } from "./lib/classify.ts";
import type { PreviewInput } from "./lib/preview.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
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

  let result;
  try {
    result = await runCuration(
      { supabase, env: (k) => Deno.env.get(k) },
      { dry: !live, maxAi: Number.isFinite(maxAi) ? maxAi : undefined, onlySource, budgetMs: 120_000, trigger: typeof body.trigger === "string" ? body.trigger : undefined, stopAfter: !live && Number(body.stop_after) > 0 ? Number(body.stop_after) : undefined },
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[curate-v2 실패]", e);
    if (live) await sendAlert(webhook, { title: "큐레이션 실행 실패 (curate-v2)", description: msg, level: "error" });
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // 정기 실행이 끝나면 새로 발행된 콘텐츠를 백그라운드로 품질 감사 — 호출 자체가 실패하면 알림
  if (live) {
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
