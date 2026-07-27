import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

/** 콘텐츠 품질 감사에서 걸린 기사를 "확인했으나 수정하지 않기로 함"으로 완료처리 — 목록에서 제외 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  const supabase = createAdminClient();
  const { error } = await supabase.from("news").update({ audit_dismissed_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
