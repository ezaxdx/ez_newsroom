import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { normalizeKey } from "@/lib/event-match";

// 자동 비공개 규칙 — name(행사명) | category(AKEI 분야) | industry(KEOA·쇼알라 품목)

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_keyword_filters")
    .select("id, keyword, memo, filter_type, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 규칙별 "최근 수집에서 제외한 건수" — 최근 수집 기록 12개의 규칙별 제외 건수를 합산 (한 번도 안 걸린 규칙은 정리 후보)
  const stats: Record<string, number> = {};
  let statsReady = false;
  const { data: logs, error: logErr } = await supabase
    .from("scrape_logs").select("dropped_by_rule").order("created_at", { ascending: false }).limit(12);
  if (!logErr) {
    statsReady = true;
    for (const l of (logs ?? []) as { dropped_by_rule: Record<string, number> | null }[])
      for (const [reason, n] of Object.entries(l.dropped_by_rule ?? {})) stats[reason] = (stats[reason] ?? 0) + n;
  }
  return NextResponse.json({ data, stats, statsReady });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { keyword, memo, filter_type } = await req.json();
  if (!keyword?.trim()) return NextResponse.json({ error: "keyword required" }, { status: 400 });
  const supabase = createAdminClient();
  const type: "name" | "industry" | "category" =
    filter_type === "industry" || filter_type === "category" ? filter_type : "name";
  const { data, error } = await supabase
    .from("event_keyword_filters")
    .insert({ keyword: keyword.trim(), memo: memo?.trim() || null, filter_type: type })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 이미 들어와 있는 공개 행사에도 즉시 적용 (행사명·분야 규칙).
  // 이즈픽, 관리자가 직접 공개/비공개를 바꾼 행사(publish_locked), "제외하지 않기"로 허용한 행사는 제외
  let hiddenIds: string[] = [];
  if (type === "name" || type === "category") {
    const col = type === "name" ? "event_name" : "category";
    const kw = keyword.trim();
    const query = () => supabase.from("convention_events").select("id, event_name")
      .ilike(col, `%${kw}%`).eq("is_published", true).eq("is_ezpmp_pick", false);
    let sel = await query().eq("publish_locked", false);
    if (sel.error && /publish_locked/.test(sel.error.message)) sel = await query();  // 05_events.sql 적용 전

    const { data: ex } = await supabase.from("event_filter_exceptions").select("name_key");
    const allowed = new Set(((ex ?? []) as { name_key: string }[]).map((r) => r.name_key));
    const ids = ((sel.data ?? []) as { id: string; event_name: string }[])
      .filter((r) => !allowed.has(normalizeKey(r.event_name) || r.event_name.toLowerCase()))
      .map((r) => r.id);
    if (ids.length) {
      let up = await supabase.from("convention_events").update({ is_published: false, hidden_reason: "rule" }).in("id", ids);
      if (up.error && /hidden_reason/.test(up.error.message)) up = await supabase.from("convention_events").update({ is_published: false }).in("id", ids);
      if (!up.error) hiddenIds = ids;
    }
  }
  return NextResponse.json({ data, hidden: hiddenIds.length, hidden_ids: hiddenIds });
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
