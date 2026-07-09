import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// 오늘 KST 기준 진행 중인 발송 현황 반환
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();

  const now = new Date();
  const todayKST = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayKSTStr = todayKST.toISOString().split("T")[0];
  const kstDayStart = new Date(`${todayKSTStr}T00:00:00+09:00`).toISOString();
  const kstDayEnd   = new Date(`${todayKSTStr}T23:59:59+09:00`).toISOString();

  const { data: issue } = await supabase
    .from("newsletter_issues")
    .select("id, vol_number, target_count, status")
    .in("status", ["sending", "partial"])
    .gte("sent_at", kstDayStart)
    .lte("sent_at", kstDayEnd)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!issue) return NextResponse.json({ ok: true, progress: null });

  const [{ data: successLogs }, { data: subscribers }] = await Promise.all([
    supabase.from("newsletter_send_logs").select("email").eq("issue_id", issue.id).eq("status", "success"),
    supabase.from("newsletter_subscribers").select("email").eq("is_active", true),
  ]);

  const sentSet = new Set((successLogs ?? []).map(l => l.email as string));
  const allEmails = (subscribers ?? []).map(s => s.email as string);
  const totalSent = sentSet.size;
  const targetCount = allEmails.length;
  const remainingCount = allEmails.filter(e => !sentSet.has(e)).length;
  const round = Math.ceil(totalSent / 50) || 1;

  return NextResponse.json({
    ok: true,
    progress: { vol_number: issue.vol_number, totalSent, targetCount, remainingCount, round },
  });
}
