import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { NewsItem } from "@/lib/types";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
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

  // 한 건씩 순차 대기(await in for-loop)하면 항목 수만큼 왕복이 쌓여 느려짐 — 병렬로 전송
  await Promise.all(items.map((item) => {
    // undefined(조회 실패/누락)를 "새로 발행됨"으로 오인하면 published_at이 잘못 리셋될 수 있어
    // 명시적으로 false(발행 안 된 상태)로 확인된 경우에만 "새로 발행"으로 간주
    const justPublished = item.is_published && wasPublished.get(item.id) === false;
    return supabase
      .from("news")
      .update({
        is_published: item.is_published,
        display_order: item.display_order,
        level: item.level,
        ...(justPublished && { published_at: new Date().toISOString() }),
      })
      .eq("id", item.id);
  }));

  revalidatePath("/");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
