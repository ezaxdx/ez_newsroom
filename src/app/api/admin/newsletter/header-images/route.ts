import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_HEADER_IMAGE = { label: "기본", url: "/images/ez-letter-header.png", flap_url: undefined as string | undefined };

// 뉴스레터 헤더 배경 이미지 후보 목록 관리 — "기본" 하나는 코드에 고정, 나머지(이벤트용 등)는 curation_settings에 누적
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data: settings } = await supabase
    .from("curation_settings").select("newsletter_header_images").limit(1).single();
  const extra: { label: string; url: string }[] = Array.isArray(settings?.newsletter_header_images)
    ? settings.newsletter_header_images : [];

  return NextResponse.json({ data: [DEFAULT_HEADER_IMAGE, ...extra] });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: { label?: string; url?: string; flap_url?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const label = body.label?.trim();
  const url = body.url?.trim();
  const flap_url = body.flap_url?.trim() || undefined;
  if (!label || !url) return NextResponse.json({ error: "label, url 필요" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: settings } = await supabase
    .from("curation_settings").select("id, newsletter_header_images").limit(1).single();
  if (!settings?.id) return NextResponse.json({ error: "curation_settings를 찾을 수 없습니다." }, { status: 500 });

  const existing: { label: string; url: string; flap_url?: string }[] = Array.isArray(settings.newsletter_header_images)
    ? settings.newsletter_header_images : [];
  const updated = [...existing.filter((e) => e.label !== label), { label, url, ...(flap_url ? { flap_url } : {}) }];

  const { error } = await supabase
    .from("curation_settings").update({ newsletter_header_images: updated }).eq("id", settings.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: [DEFAULT_HEADER_IMAGE, ...updated] });
}

export async function DELETE(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { searchParams } = new URL(req.url);
  const label = searchParams.get("label");
  if (!label) return NextResponse.json({ error: "label 필요" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: settings } = await supabase
    .from("curation_settings").select("id, newsletter_header_images").limit(1).single();
  if (!settings?.id) return NextResponse.json({ error: "curation_settings를 찾을 수 없습니다." }, { status: 500 });

  const existing: { label: string; url: string; flap_url?: string }[] = Array.isArray(settings.newsletter_header_images)
    ? settings.newsletter_header_images : [];
  const updated = existing.filter((e) => e.label !== label);

  const { error } = await supabase
    .from("curation_settings").update({ newsletter_header_images: updated }).eq("id", settings.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: [DEFAULT_HEADER_IMAGE, ...updated] });
}
