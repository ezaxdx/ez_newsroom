import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGmailClient, makeRawMessage } from "@/lib/gmail-sender";

export const maxDuration = 60;

// ── GET: 미수신자 목록 조회 ───────────────────────────────
export async function GET(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const issue_id = req.nextUrl.searchParams.get("issue_id");
  if (!issue_id)
    return NextResponse.json({ error: "issue_id가 필요합니다." }, { status: 400 });

  const supabase = createAdminClient();

  // 이미 성공한 수신자
  const { data: successLogs } = await supabase
    .from("newsletter_send_logs")
    .select("email")
    .eq("issue_id", issue_id)
    .eq("status", "success");

  const sentEmails = new Set((successLogs ?? []).map(l => l.email as string));

  // 현재 활성 수신자 전체
  const { data: subscribers } = await supabase
    .from("newsletter_subscribers")
    .select("email, name")
    .eq("is_active", true)
    .order("email");

  const unsent = (subscribers ?? []).filter(s => !sentEmails.has(s.email));
  const sent   = (subscribers ?? []).filter(s =>  sentEmails.has(s.email));

  return NextResponse.json({
    ok: true,
    unsent,          // { email, name }[]
    sent_count: sent.length,
    unsent_count: unsent.length,
  });
}

// ── POST: 선택한 수신자에게 재발송 ──────────────────────────
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: { issue_id: string; emails: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { issue_id, emails } = body;
  if (!issue_id)
    return NextResponse.json({ error: "issue_id가 필요합니다." }, { status: 400 });
  if (!Array.isArray(emails) || emails.length === 0)
    return NextResponse.json({ error: "발송할 이메일 목록이 없습니다." }, { status: 400 });

  const supabase = createAdminClient();

  const { data: issue, error: issueErr } = await supabase
    .from("newsletter_issues")
    .select("id, vol_number, html_content, total_sent, total_failed, target_count")
    .eq("id", issue_id)
    .single();

  if (issueErr || !issue)
    return NextResponse.json({ error: "이슈를 찾을 수 없습니다." }, { status: 404 });
  if (!issue.html_content)
    return NextResponse.json({ error: "저장된 HTML이 없습니다." }, { status: 400 });

  await supabase.from("newsletter_issues")
    .update({ status: "sending" })
    .eq("id", issue_id);

  const gmail = await getGmailClient();
  const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  const from = `"EZ Letter" <${fromEmail}>`;

  const todayKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const send_date = `${todayKST.getUTCFullYear()}.${String(todayKST.getUTCMonth() + 1).padStart(2, "0")}.${String(todayKST.getUTCDate()).padStart(2, "0")}`;
  const subject = `[EZ Letter] Vol.${issue.vol_number} · ${send_date}`;

  const BATCH_SIZE = 5;
  let total_sent = 0, total_failed = 0;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    if (i > 0) await new Promise(r => setTimeout(r, 200));

    const batchResults = await Promise.all(
      batch.map(async (to) => {
        try {
          const raw = makeRawMessage({ from, to, subject, html: issue.html_content! });
          await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
          return { email: to, status: "success" as const, error_message: null };
        } catch (err) {
          return {
            email: to, status: "failed" as const,
            error_message: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    await supabase.from("newsletter_send_logs").insert(
      batchResults.map(r => ({ ...r, issue_id }))
    );

    total_sent  += batchResults.filter(r => r.status === "success").length;
    total_failed += batchResults.filter(r => r.status === "failed").length;
  }

  const newTotalSent  = (issue.total_sent  ?? 0) + total_sent;
  const newTotalFailed = total_failed;
  const allSent = newTotalSent >= (issue.target_count ?? 0) && newTotalFailed === 0;
  const finalStatus = newTotalSent === 0 ? "failed" : allSent ? "sent" : "partial";

  await supabase.from("newsletter_issues")
    .update({ status: finalStatus, total_sent: newTotalSent, total_failed: newTotalFailed })
    .eq("id", issue_id);

  return NextResponse.json({ ok: true, total_sent, total_failed, new_status: finalStatus });
}
