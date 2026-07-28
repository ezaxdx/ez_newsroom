import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsletter_issues")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 이슈별 오픈 수(최초 오픈만 집계된 opened_at 기준) — 별도 조회 후 JS에서 그룹핑
  const issueIds = (data ?? []).map((i) => i.id);
  const openedCounts: Record<string, number> = {};
  if (issueIds.length > 0) {
    const { data: openedLogs } = await supabase
      .from("newsletter_send_logs")
      .select("issue_id")
      .in("issue_id", issueIds)
      .not("opened_at", "is", null);
    for (const l of openedLogs ?? []) {
      const id = l.issue_id as string;
      openedCounts[id] = (openedCounts[id] ?? 0) + 1;
    }
  }
  const withOpened = (data ?? []).map((i) => ({ ...i, opened_count: openedCounts[i.id] ?? 0 }));

  return NextResponse.json({ data: withOpened });
}
