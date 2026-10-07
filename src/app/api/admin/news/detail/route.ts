import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** 큐레이션 보드 편집 창·다시 쓰기 비교 창이 열릴 때 그 기사 한 건의 본문·시사점만 읽음 (목록에는 싣지 않는 큰 컬럼) */
export async function GET(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("news").select("content_long, implications").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ content_long: data.content_long ?? "", implications: data.implications ?? "" });
}
