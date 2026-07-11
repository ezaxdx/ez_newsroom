import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_keyword_filters")
    .select("id, keyword, memo, filter_type, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { keyword, memo, filter_type } = await req.json();
  if (!keyword?.trim()) return NextResponse.json({ error: "keyword required" }, { status: 400 });
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_keyword_filters")
    .insert({
      keyword: keyword.trim(),
      memo: memo?.trim() || null,
      filter_type: filter_type === "industry" ? "industry" : "name",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = createAdminClient();
  const { error } = await supabase.from("event_keyword_filters").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
