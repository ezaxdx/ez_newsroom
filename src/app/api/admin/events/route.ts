import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = createAdminClient();
  let query = supabase
    .from("convention_events")
    .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, image_url, is_published, created_at")
    .order("start_date", { ascending: true })
    .limit(2000);

  if (from) query = query.gte("start_date", from);
  if (to) query = query.lte("start_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // 허용 필드만 업데이트
  const ALLOWED = ["is_published", "image_url", "description"];
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in fields) updates[key] = fields[key];
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("convention_events")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
