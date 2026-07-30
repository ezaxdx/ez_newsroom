import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const SELECT = "id, enabled, title, form_url";

// 숨은 그림(고양이) 찾기 이벤트 전역 설정 — 단일 행만 사용하며, 없으면 첫 저장 시 생성
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsroom_event_settings")
    .select(SELECT)
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? { enabled: false, title: "숨은 고양이를 찾아라", form_url: null } });
}

export async function PATCH(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const updates = {
    enabled: !!body.enabled,
    title: body.title?.trim() || "숨은 고양이를 찾아라",
    form_url: body.form_url?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("newsroom_event_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  const query = existing?.id
    ? supabase.from("newsroom_event_settings").update(updates).eq("id", existing.id)
    : supabase.from("newsroom_event_settings").insert(updates);

  const { data, error } = await query.select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
