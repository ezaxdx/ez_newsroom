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

  // 항상 신규 insert — 같은 URL의 살아있는 기사를 실수로 덮어쓰지 않기 위함.
  // 큐레이션 보드에서 실제로 삭제(+저장)된 URL은 행이 사라진 상태라 그대로 재작성 가능하고,
  // 아직 삭제되지 않은(=살아있는) URL이면 유니크 제약으로 막혀 안전하게 실패함.
  const { data, error } = await supabase.from("news").insert(payload).select().single();

  if (error) {
    // 유니크 제약 위반(23505) = 같은 URL 기사가 아직 존재함 → 친절한 안내로 교체
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "이미 등록된 URL입니다. 큐레이션 보드에서 해당 기사를 삭제하고 '변경사항 저장'까지 완료한 뒤 다시 시도하세요." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}
