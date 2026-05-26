import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("convention_events")
    .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, is_published, created_at")
    .order("start_date", { ascending: true })
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, is_published } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("convention_events")
    .update({ is_published })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
