import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await req.json();

  const supabase = createClient(supabaseUrl, serviceKey);
  const payload = {
    title: body.title,
    summary_short: body.summary_short,
    content_long: body.content_long,
    implications: body.implications,
    image_url: body.image_url || null,
    original_url: body.original_url || null,
    category: body.category,
    level: body.level ?? "Intermediate",
    quality_score: body.quality_score ?? null,
    quality_criteria: body.quality_criteria ?? null,
    is_published: body.is_published ?? false,
    priority_score: 100,
    display_order: 0,
    published_at: new Date().toISOString(),
  };

  // original_url이 있으면 upsert — 같은 URL로 이미 저장된 기사가 있으면
  // (삭제 반영 지연·재수집 등으로) 새로 만들지 않고 내용을 덮어써 재발행 가능하게 함
  const { data, error } = payload.original_url
    ? await supabase.from("news").upsert(payload, { onConflict: "original_url" }).select().single()
    : await supabase.from("news").insert(payload).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
