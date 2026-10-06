import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { explainScore } from "@/lib/event-score";
import { loadScoringContext } from "@/lib/event-score-context";

export const dynamic = "force-dynamic";

// 점수 미리보기 — 앞으로 30일 이내 공개 행사를 실제 뉴스레터와 같은 산식으로 점수 매겨 상위 N건과 점수 구성을 보여줌
// (주최사 목록·수행실적을 바꾼 뒤 결과가 의도대로인지 확인하는 용도)
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const end = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const { data } = await supabase.from("convention_events")
    .select("id, event_name, event_name_en, start_date, venue, category, industry, organizer, is_ezpmp_pick")
    .eq("is_published", true).neq("is_concurrent", true)
    .gte("start_date", todayStr).lte("start_date", end).limit(300);

  const ctx = await loadScoringContext(supabase);
  const rows = (data ?? []).map((e) => {
    const b = explainScore({
      event_name: e.event_name, event_name_en: e.event_name_en, category: e.category, industry: e.industry,
      organizer: e.organizer, venue: e.venue ?? "", start_date: e.start_date,
    }, today, ctx);
    return { id: e.id, name: e.event_name, start_date: e.start_date, organizer: e.organizer, pick: !!e.is_ezpmp_pick, ...b };
  }).sort((a, b) => b.total - a.total).slice(0, 15);

  return NextResponse.json({ rows, total: data?.length ?? 0 });
}
