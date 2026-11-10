import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronAuth } from "@/lib/verify-cron";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";
import { sendDiscordAlert } from "@/lib/discord-alert";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const db = createAdminClient();
  const unauth = verifyCronAuth(req);
  if (unauth) {
    const token = req.headers.get("authorization")?.match(/^Bearer (.{32,512})$/)?.[1];
    if (!token) return unauth;
    const { data, error } = await db.rpc("authorize_newsletter_worker", { p_secret: token });
    if (error || data !== true) return unauth;
  }
  const { data: job, error: claimError } = await db.rpc("claim_newsletter_schedule");
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!job) return NextResponse.json({ skipped: true });
  let cursor = job.cursor as number;
  let sent = 0, failed = 0;
  try {
    const { data: issue, error } = await db.from("newsletter_issues").select("html_content,total_sent,total_failed,vol_number").eq("id", job.issue_id).single();
    if (error || !issue?.html_content) throw new Error(error?.message ?? "예약 본문 없음");
    sent = issue.total_sent ?? 0; failed = issue.total_failed ?? 0;
    const snapshot = job.recipients as { id: string; email: string }[];
    const batch = snapshot.slice(cursor, cursor + 25);
    const { data: active, error: activeError } = await db.from("newsletter_subscribers").select("id,email").eq("is_active", true).in("id", batch.map(r => r.id));
    if (activeError) throw new Error(activeError.message);
    const activeSet = new Set((active ?? []).map(r => r.id + ":" + r.email));
    const eligible = batch.filter(r => activeSet.has(r.id + ":" + r.email));

    let processed = 0;
    if (eligible.length) {
      const result = await sendNewsletterViaGmail({ fromName: "EZ Letter", fromEmail: process.env.GMAIL_USER ?? "ez.micedx1@gmail.com", subject: job.subject,
        html: issue.html_content, recipients: eligible, issueId: job.issue_id,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app", timeBudgetMs: 35000,
        beforeBatch: async () => {
          const { data, error } = await db.from("newsletter_schedules").select("cancel_requested,status,lease").eq("id", job.id).single();
          if (error) throw new Error(error.message);
          return !data.cancel_requested && data.status === "running" && data.lease === job.lease;
        },
        onBatchComplete: async results => {
          const { error: logError } = await db.from("newsletter_send_logs").insert(results.map(r => ({ ...r, issue_id: job.issue_id })));
          if (logError) throw new Error("발송 결과 기록 실패: " + logError.message);
          sent += results.filter(r => r.status === "success").length; failed += results.filter(r => r.status === "failed").length;
          const { error } = await db.from("newsletter_issues").update({ total_sent: sent, total_failed: failed }).eq("id", job.issue_id);
          if (error) throw new Error(error.message);
        }
      });
      processed = result.processed;
    }
    // Unsubscribed/deleted recipients are skipped. Unattempted recipients remain for the next minute.
    cursor = processed === eligible.length ? job.cursor + batch.length : job.cursor + batch.findIndex(r => r.id === eligible[processed].id);
    const { data: status, error: finishError } = await db.rpc("finish_newsletter_schedule", { p_id: job.id, p_lease: job.lease, p_cursor: cursor, p_sent: sent, p_failed: failed });
    if (finishError) throw new Error(finishError.message);
    const done = status === "completed"; const stopped = status === "cancelled";
    if (done || stopped) await sendDiscordAlert({ title: `뉴스레터 Vol.${issue.vol_number} 예약 발송 ${stopped ? "중지" : "완료"}`, description: `성공 ${sent}명 / 실패 ${failed}명. 실패 건은 이력에서 확인해주세요.`, level: failed ? "warning" : "info" });
    return NextResponse.json({ ok: true, status, cursor });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("newsletter_schedules").update({ status: "attention", error }).eq("id", job.id).eq("lease", job.lease);
    await db.from("newsletter_issues").update({ status: sent ? "partial" : "failed" }).eq("id", job.issue_id);
    await sendDiscordAlert({ title: "뉴스레터 예약 발송 확인 필요", description: error + " · 중복 방지를 위해 자동 재시도하지 않습니다. 발송 로그와 Gmail 보낸메일을 확인해주세요.", level: "error" });
    return NextResponse.json({ error }, { status: 500 });
  }
}
