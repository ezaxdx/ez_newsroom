import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";

export const maxDuration = 60;

// ── GET: 미수신자 목록 조회 ───────────────────────────────
export async function GET(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const issue_id = req.nextUrl.searchParams.get("issue_id");
  if (!issue_id)
    return NextResponse.json({ error: "issue_id가 필요합니다." }, { status: 400 });

  const supabase = createAdminClient();

  // 같은 vol_number의 모든 issue_id 조회 → 중복 발송 방지
  const { data: thisIssue } = await supabase
    .from("newsletter_issues")
    .select("vol_number")
    .eq("id", issue_id)
    .single();

  const { data: sameVolIssues } = await supabase
    .from("newsletter_issues")
    .select("id")
    .eq("vol_number", thisIssue?.vol_number ?? "");

  const allIssueIds = (sameVolIssues ?? []).map(i => i.id);

  // 같은 vol의 모든 issue에서 이미 성공한 수신자 합산
  const { data: successLogs } = await supabase
    .from("newsletter_send_logs")
    .select("email")
    .in("issue_id", allIssueIds.length > 0 ? allIssueIds : [issue_id])
    .eq("status", "success");

  const sentEmails = new Set((successLogs ?? []).map(l => l.email as string));

  // 실패 로그에서 에러 메시지 수집
  const { data: failedLogs } = await supabase
    .from("newsletter_send_logs")
    .select("email, error_message")
    .eq("issue_id", issue_id)
    .eq("status", "failed");
  const failedMap = new Map((failedLogs ?? []).map(l => [l.email as string, l.error_message as string | null]));

  // 현재 활성 수신자 전체 (id 포함 — 비활성화 버튼용)
  const { data: subscribers } = await supabase
    .from("newsletter_subscribers")
    .select("id, email, name")
    .eq("is_active", true)
    .order("email");

  const unsent = (subscribers ?? [])
    .filter(s => !sentEmails.has(s.email))
    .map(s => ({ id: s.id, email: s.email, name: s.name, error_message: failedMap.get(s.email) ?? null }));
  const sent   = (subscribers ?? []).filter(s => sentEmails.has(s.email));

  return NextResponse.json({
    ok: true,
    unsent,
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

  const todayKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const send_date = `${todayKST.getUTCFullYear()}.${String(todayKST.getUTCMonth() + 1).padStart(2, "0")}.${String(todayKST.getUTCDate()).padStart(2, "0")}`;
  const subject = `[EZ Letter] Vol.${issue.vol_number} · ${send_date}`;

  const fromEmail = process.env.GMAIL_FROM_EMAIL ?? "ez.micedx1@gmail.com";
  // newsletter_issues.total_sent 은 수동 수정될 수 있으므로 실제 로그 기준으로 초기화
  const { data: existingSuccessLogs } = await supabase
    .from("newsletter_send_logs").select("email").eq("issue_id", issue_id).eq("status", "success");
  let total_sent = existingSuccessLogs?.length ?? 0;
  let total_failed = issue.total_failed ?? 0;

  await sendNewsletterViaGmail({
    fromName: "EZ Letter",
    fromEmail,
    subject,
    html: issue.html_content!,
    recipients: emails,
    onBatchComplete: async (batchResults) => {
      const batchSent = batchResults.filter(r => r.status === "success").length;
      const batchFailed = batchResults.filter(r => r.status === "failed").length;
      total_sent += batchSent;
      total_failed += batchFailed;
      await Promise.all([
        supabase.from("newsletter_send_logs").insert(
          batchResults.map(r => ({ ...r, issue_id }))
        ),
        supabase.from("newsletter_issues").update({
          total_sent,
          total_failed,
          status: "sent",
        }).eq("id", issue_id),
      ]);
    },
  });

  return NextResponse.json({ ok: true, total_sent, total_failed, target_count: emails.length });
}
