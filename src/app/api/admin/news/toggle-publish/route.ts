import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { id, is_published } = await req.json();
  if (!id || typeof is_published !== "boolean") {
    return NextResponse.json({ error: "id, is_published 필요" }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from("news").update({ is_published }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
