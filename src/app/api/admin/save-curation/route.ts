import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { NewsItem } from "@/lib/types";

export async function POST(req: NextRequest) {
  const {
    items,
    deletedIds,
    republishIds,
  }: { items: NewsItem[]; deletedIds?: string[]; republishIds?: string[] } = await req.json();

  const supabase = createAdminClient();

  // 삭제 처리
  if (deletedIds?.length) {
    await supabase.from("news").delete().in("id", deletedIds);
  }

  // 아카이브 → 메인 재발행: published_at을 현재 시각으로 갱신
  if (republishIds?.length) {
    await supabase
      .from("news")
      .update({ published_at: new Date().toISOString() })
      .in("id", republishIds);
  }

  // 순서/발행 상태 업데이트
  if (!items.length) {
    revalidatePath("/");
    revalidatePath("/admin");
    return NextResponse.json({ ok: true });
  }

  const { data: currentStates } = await supabase
    .from("news")
    .select("id, is_published")
    .in("id", items.map((i) => i.id));
  const wasPublished = new Map((currentStates ?? []).map((s) => [s.id, s.is_published]));

  for (const item of items) {
    const justPublished = item.is_published && !wasPublished.get(item.id);
    await supabase
      .from("news")
      .update({
        is_published: item.is_published,
        display_order: item.display_order,
        level: item.level,
        ...(justPublished && { published_at: new Date().toISOString() }),
      })
      .eq("id", item.id);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
