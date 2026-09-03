import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * 큐레이션 보드에서 관리자가 기사 내용을 직접 수정 — 제목/요약/시사점/이미지만 대상.
 * 본문(content_long)은 상세 편집이 필요해 대상에서 제외(필요하면 정합성 관리의
 * 콘텐츠 감사 수정 화면 사용).
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, title, summary_short, implications, image_url } = await req.json();
  if (!id || typeof title !== "string" || !title.trim() || typeof summary_short !== "string" || !summary_short.trim()) {
    return NextResponse.json({ error: "id, title, summary_short 필요" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("news").update({
    title: title.trim(),
    summary_short: summary_short.trim(),
    implications: typeof implications === "string" ? implications.trim() : null,
    image_url: typeof image_url === "string" && image_url.trim() ? image_url.trim() : null,
  }).eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
