import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { normalizeKey } from "@/lib/event-match";

// "제외하지 않기" — 비공개 규칙에 걸려 수집에서 빠진 행사를 허용 목록에 올리고 바로 등록
// 이후 수집에서도 같은 이름은 규칙에 걸려도 제외되지 않음 (supabase/revamp/07_events_ui.sql)

type Candidate = {
  event_name: string; event_name_en: string | null; start_date: string; end_date: string | null;
  venue: string; venue_region: string | null; location: string | null; category: string | null; industry: string | null;
  organizer: string | null; image_url: string | null; website: string | null; source: string;
};

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { candidate } = (await req.json()) as { candidate?: Candidate };
  if (!candidate?.event_name || !candidate.start_date || !candidate.venue) {
    return NextResponse.json({ error: "행사 정보가 부족합니다" }, { status: 400 });
  }
  const supabase = createAdminClient();

  const name_key = normalizeKey(candidate.event_name) || candidate.event_name.toLowerCase();
  const { error: exErr } = await supabase
    .from("event_filter_exceptions")
    .upsert({ name_key, event_name: candidate.event_name }, { onConflict: "name_key", ignoreDuplicates: true });
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

  // 이미 같은 이름·시작일 행사가 있으면 다시 만들지 않음
  const { data: dup } = await supabase.from("convention_events").select("id")
    .eq("event_name", candidate.event_name).eq("start_date", candidate.start_date).limit(1);
  if (dup?.length) return NextResponse.json({ ok: true, existing: true });

  const row = {
    venue: candidate.venue, venue_region: candidate.venue_region, event_name: candidate.event_name,
    event_name_en: candidate.event_name_en, start_date: candidate.start_date, end_date: candidate.end_date,
    location: candidate.location, category: candidate.category, industry: candidate.industry,
    organizer: candidate.organizer, image_url: candidate.image_url, website: candidate.website,
    is_published: true, source: candidate.source,
  };
  const { data, error } = await supabase.from("convention_events").insert(row)
    .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, image_url, is_published, is_ezpmp_pick, source, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, added: data });
}
