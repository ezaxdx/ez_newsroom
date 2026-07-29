import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// 명단 전체 삭제 직전에 호출 — 매달 전체 삭제 후 재업로드하는 운영 방식 때문에
// unsubscribed_at 이력이 사라지므로, 삭제 직전 총원/수신거부 인원을 스냅샷으로 남김
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsletter_subscriber_snapshots")
    .select("id, snapshot_date, total_count, unsubscribed_count, created_at")
    .order("snapshot_date", { ascending: false })
    .limit(24);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const { total_count, unsubscribed_count } = body;
  if (typeof total_count !== "number" || typeof unsubscribed_count !== "number") {
    return NextResponse.json({ error: "total_count, unsubscribed_count 필요" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsletter_subscriber_snapshots")
    .insert({ total_count, unsubscribed_count })
    .select("id, snapshot_date, total_count, unsubscribed_count, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
