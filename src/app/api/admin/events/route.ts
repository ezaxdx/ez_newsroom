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
    .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, image_url, is_published, is_ezpmp_pick, source, created_at")
    .order("start_date", { ascending: true })
    .limit(2000);

  if (from) query = query.gte("start_date", from);
  if (to) query = query.lte("start_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const { event_name, venue, start_date, end_date, organizer, category, website } = body;
  if (!event_name?.trim() || !venue?.trim() || !start_date) {
    return NextResponse.json({ error: "행사명, 센터, 시작일은 필수입니다." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("convention_events")
    .insert({
      event_name: event_name.trim(),
      venue: venue.trim(),
      start_date,
      end_date: end_date || null,
      organizer: organizer?.trim() || null,
      category: category?.trim() || null,
      website: website?.trim() || null,
      source: "manual",
      is_published: true,
      is_ezpmp_pick: false,
      is_concurrent: false,
    })
    .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, image_url, is_published, is_ezpmp_pick, source, created_at")
    .single();

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
  const ALLOWED = ["is_published", "is_ezpmp_pick", "image_url", "description", "event_name", "organizer", "start_date", "end_date", "venue", "news_keywords"];
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in fields) updates[key] = fields[key];
  }

  const supabase = createAdminClient();
  // 관리자가 공개/비공개를 직접 바꾼 행사는 잠가서, 이후 수집·규칙 소급 적용이 덮어쓰지 않게 함
  // 비공개 사유도 같이 기록 — 직접 비공개하면 manual, 다시 공개하면 비움 (05/07 SQL 적용 전이면 없는 컬럼은 빼고 재시도)
  const toggled = "is_published" in updates;
  const full = toggled
    ? { ...updates, publish_locked: true, hidden_reason: updates.is_published === false ? "manual" : null }
    : updates;
  let { error } = await supabase.from("convention_events").update(full).eq("id", id);
  if (error && toggled && /hidden_reason/.test(error.message)) {
    ({ error } = await supabase.from("convention_events").update({ ...updates, publish_locked: true }).eq("id", id));
  }
  if (error && toggled && /publish_locked/.test(error.message)) {
    ({ error } = await supabase.from("convention_events").update(updates).eq("id", id));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
