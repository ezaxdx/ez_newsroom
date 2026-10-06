import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/scrape-logs            → 최근 수집 기록 12개 (가볍게 — 진행 상황 폴링용)
// GET /api/admin/scrape-logs?dropped=1  → 규칙으로 제외된 행사 목록(dropped)까지 포함 (자동 제외 내역 탭용, 용량이 큼)
export async function GET(req: Request) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const withDropped = new URL(req.url).searchParams.get("dropped") === "1";
  const supabase = createAdminClient();
  const base = "id, created_at, ok, showala_scraped, keoa_scraped, inserted, updated, auto_hidden, elapsed_sec, error";
  const ext = `source, akei_scraped, dropped_count${withDropped ? ", dropped" : ""}`;

  let { data, error }: { data: unknown[] | null; error: { message: string } | null } = await supabase
    .from("scrape_logs")
    .select(`${base}, ${ext}`)
    .order("created_at", { ascending: false })
    .limit(withDropped ? 6 : 12);
  if (error) {
    // 05 SQL 적용 전 — 기존 컬럼만 조회
    ({ data, error } = await supabase.from("scrape_logs").select(base).order("created_at", { ascending: false }).limit(12));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
