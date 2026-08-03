import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type FooterBanner = { image_url?: string; link_url?: string; enabled?: boolean };

// 뉴스레터 하단 상시 배너 — 헤더 이미지처럼 발송마다 고르는 게 아니라, 켜두면 계속 노출되는 단일 설정.
// 시즌마다 관리자가 이미지·링크만 교체하면 다음 발송부터 자동 반영됨.
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data: settings } = await supabase
    .from("curation_settings").select("newsletter_footer_banner").limit(1).single();
  const banner: FooterBanner = settings?.newsletter_footer_banner ?? {};

  return NextResponse.json({ data: banner });
}

export async function PUT(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: FooterBanner;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const banner: FooterBanner = {
    image_url: body.image_url?.trim() || undefined,
    link_url: body.link_url?.trim() || undefined,
    enabled: body.enabled === true,
  };

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("curation_settings").select("id").limit(1).single();
  if (!existing?.id) return NextResponse.json({ error: "curation_settings를 찾을 수 없습니다." }, { status: 500 });

  const { error } = await supabase
    .from("curation_settings").update({ newsletter_footer_banner: banner }).eq("id", existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: banner });
}
