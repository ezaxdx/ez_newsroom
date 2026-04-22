import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { NewsItem } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { items, deletedIds }: { items: NewsItem[]; deletedIds?: string[] } = await req.json();

  const supabase = createAdminClient();

  // 삭제 처리
  if (deletedIds?.length) {
    await supabase.from("news").delete().in("id", deletedIds);
  }

  // 순서/발행 상태 업데이트
  for (const item of items) {
    await supabase
      .from("news")
      .update({ is_published: item.is_published, display_order: item.display_order })
      .eq("id", item.id);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
