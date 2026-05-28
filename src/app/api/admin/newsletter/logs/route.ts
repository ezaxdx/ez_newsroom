import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { searchParams } = new URL(req.url);
  const issue_id = searchParams.get("issue_id");
  const status = searchParams.get("status"); // "failed" | null (all)

  if (!issue_id) {
    return NextResponse.json({ error: "issue_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  let query = supabase
    .from("newsletter_send_logs")
    .select("id, email, status, error_message, sent_at")
    .eq("issue_id", issue_id)
    .order("sent_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
