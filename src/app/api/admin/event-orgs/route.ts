import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { orgKey } from "@/lib/event-score";
import { clearScoringContextCache } from "@/lib/event-score-context";

// 행사 점수의 주최사 가산 목록 — peer(동종 업계) · venue(장소 운영사) · peo(PEO 계열, 후순위) · client(수행실적 발주처, 엑셀로 자동 갱신)

const EDITABLE = ["peer", "venue", "peo"] as const;

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_org_affinity").select("id, org_key, org_name, tier, source, hit_count, last_year").order("org_name");
  if (error) return NextResponse.json({ unavailable: true, error: error.message });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { org_name, tier } = (await req.json()) as { org_name?: string; tier?: string };
  const name = org_name?.trim();
  if (!name) return NextResponse.json({ error: "기관명을 입력하세요" }, { status: 400 });
  if (!EDITABLE.includes(tier as (typeof EDITABLE)[number])) return NextResponse.json({ error: "구분이 올바르지 않습니다" }, { status: 400 });
  const key = orgKey(name);
  if (key.length < 2) return NextResponse.json({ error: "기관명이 너무 짧습니다" }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("event_org_affinity")
    .insert({ org_key: key, org_name: name, tier, source: "manual" })
    .select("id, org_key, org_name, tier, source, hit_count, last_year").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "이미 같은 구분에 등록돼 있습니다" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  clearScoringContextCache();
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = createAdminClient();
  const { error } = await supabase.from("event_org_affinity").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  clearScoringContextCache();
  return NextResponse.json({ ok: true });
}
