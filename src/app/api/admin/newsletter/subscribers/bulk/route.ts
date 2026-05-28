import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { subscribers } = await req.json() as { subscribers: { email: string; name?: string }[] };
  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    return NextResponse.json({ error: "subscribers 필드가 필요합니다" }, { status: 400 });
  }

  const supabase = createAdminClient();
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const sub of subscribers) {
    const email = sub.email?.trim().toLowerCase();
    if (!email) { skipped++; continue; }
    const { error } = await supabase
      .from("newsletter_subscribers")
      .insert({ email, name: sub.name?.trim() || null })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") skipped++; // duplicate
      else errors.push(`${email}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return NextResponse.json({ ok: true, inserted, skipped, errors: errors.slice(0, 5) });
}
