import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

// GET: 전체 수집 소스 + 마지막 정기 실행 요약 (화면 상단·"최근 수집" 표시용)
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("rss_sources").select("*").order("source_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 시험 실행(dry)은 제외하고 가장 최근 정기 실행
  const { data: lastRun } = await supabase
    .from("curation_logs")
    .select("run_at, duration_ms, fetched, published, staged, skipped, failed, source_stats, errors")
    .or("run_mode.is.null,run_mode.eq.live")
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ data, lastRun: lastRun ?? null });
}

// POST: 소스·키워드 추가
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("rss_sources").insert(body).select().single();
  if (error) {
    // url 은 unique — 같은 주소·키워드를 두 번 등록하려는 경우
    const dup = error.code === "23505";
    return NextResponse.json({ error: dup ? "이미 등록된 주소(또는 키워드)입니다" : error.message }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ data });
}

// PATCH: 토글(is_active) or 수정
export async function PATCH(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, ...updates } = await req.json();
  const supabase = createAdminClient();
  const { error } = await supabase.from("rss_sources").update(updates).eq("id", id);
  if (error) {
    const dup = error.code === "23505";
    return NextResponse.json({ error: dup ? "이미 등록된 주소(또는 키워드)입니다" : error.message }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE: 소스 삭제
export async function DELETE(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id } = await req.json();
  const supabase = createAdminClient();
  const { error } = await supabase.from("rss_sources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
