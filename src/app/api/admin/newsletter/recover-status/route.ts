import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: { issue_id: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { issue_id } = body;
  if (!issue_id)
    return NextResponse.json({ error: "issue_id가 필요합니다." }, { status: 400 });

  const supabase = createAdminClient();

  const { data: issue } = await supabase
    .from("newsletter_issues")
    .select("id, status, target_count")
    .eq("id", issue_id)
    .single();

  if (!issue)
    return NextResponse.json({ error: "이슈를 찾을 수 없습니다." }, { status: 404 });

  if (issue.status !== "sending")
    return NextResponse.json({ error: "sending 상태인 이슈만 복구할 수 있습니다." }, { status: 400 });

  const { count: sentCount } = await supabase
    .from("newsletter_send_logs")
    .select("*", { count: "exact", head: true })
    .eq("issue_id", issue_id)
    .eq("status", "success");

  const { count: failedCount } = await supabase
    .from("newsletter_send_logs")
    .select("*", { count: "exact", head: true })
    .eq("issue_id", issue_id)
    .eq("status", "failed");

  const total_sent = sentCount ?? 0;
  const total_failed = failedCount ?? 0;
  const total = total_sent + total_failed;

  let newStatus: "sent" | "partial" | "failed";
  if (total === 0) {
    newStatus = "failed";
  } else if (total_failed === 0 && total_sent >= (issue.target_count ?? 1)) {
    newStatus = "sent";
  } else {
    newStatus = "partial";
  }

  await supabase
    .from("newsletter_issues")
    .update({ status: newStatus, total_sent, total_failed })
    .eq("id", issue_id);

  return NextResponse.json({ ok: true, new_status: newStatus, total_sent, total_failed });
}
