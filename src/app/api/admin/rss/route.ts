import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET: 전체 RSS 소스 조회
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("rss_sources").select("*").order("source_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST: 소스 추가
export async function POST(req: NextRequest) {
  const body = await req.json();
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("rss_sources").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// PATCH: 토글(is_active) or 수정
export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json();
  const supabase = createAdminClient();
  const { error } = await supabase.from("rss_sources").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE: 소스 삭제
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const supabase = createAdminClient();
  const { error } = await supabase.from("rss_sources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
