import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();
  const { data } = await supabase.from("newsletter_cron_settings").select("*").single();
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const body = await req.json();
  const supabase = createAdminClient();

  // upsert (항상 단일 행)
  const { data: existing } = await supabase.from("newsletter_cron_settings").select("id").single();
  if (existing) {
    const { data } = await supabase.from("newsletter_cron_settings").update({ ...body, updated_at: new Date().toISOString() }).eq("id", existing.id).select().single();
    return NextResponse.json({ data });
  } else {
    const { data } = await supabase.from("newsletter_cron_settings").insert(body).select().single();
    return NextResponse.json({ data });
  }
}
