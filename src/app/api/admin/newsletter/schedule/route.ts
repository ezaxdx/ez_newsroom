import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
export async function GET() {
  const unauth = await requireAdmin(); if (unauth) return unauth;
  const { data, error } = await createAdminClient().from("newsletter_schedules").select("id,issue_id,scheduled_at,status,cursor,cancel_requested,error,newsletter_issues(vol_number,target_count,total_sent,total_failed)").order("created_at", { ascending: false }).limit(5);
  return NextResponse.json(error ? { error: error.message } : { data }, { status: error ? 500 : 200 });
}
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin(); if (unauth) return unauth;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.at !== "string") return NextResponse.json({ error: "예약 정보를 확인해주세요." }, { status: 400 });
  if (typeof body.html !== "string" || !body.html.trim() || body.html.length > 2000000 || !Number.isInteger(body.vol) || body.vol < 1 || typeof body.subject !== "string" || !body.subject.trim() || /[\r\n]/.test(body.subject) || !Number.isFinite(Date.parse(body.at))) return NextResponse.json({ error: "미리보기와 예약 정보를 확인해주세요." }, { status: 400 });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
  const { data, error } = await createAdminClient().rpc("schedule_newsletter", { p_at: body.at, p_vol: body.vol, p_subject: body.subject.trim(), p_html: body.html.replace(/https?:\/\/localhost:\d+/g, site), p_editorial: body.editorial ?? "", p_featured: body.featured ?? [] });
  return NextResponse.json(error ? { error: error.message } : { id: data }, { status: error ? 409 : 200 });
}
export async function DELETE(req: NextRequest) {
  const unauth = await requireAdmin(); if (unauth) return unauth;
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string") return NextResponse.json({ error: "예약 ID를 확인해주세요." }, { status: 400 });
  const { error } = await createAdminClient().rpc("cancel_newsletter_schedule", { p_id: id });
  return NextResponse.json(error ? { error: error.message } : { ok: true }, { status: error ? 409 : 200 });
}
