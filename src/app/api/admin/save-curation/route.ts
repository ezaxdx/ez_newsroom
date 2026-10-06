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
    .select("id, is_published, level, title, original_title")
    .in("id", items.map((i) => i.id));
  const wasPublished = new Map((currentStates ?? []).map((s) => [s.id, s.is_published]));

  // 관리자가 레벨을 직접 고친 기사는 사례로 누적 — 다음 큐레이션부터 비슷한 기사의 레벨 판정에 참고됨
  // (카테고리·사업영역 보정과 같은 방식). level_examples 컬럼이 아직 없어도 저장 자체는 막지 않음.
  try {
    const before = new Map((currentStates ?? []).map((s) => [s.id, s]));
    const changed = items
      .map((i) => ({ i, cur: before.get(i.id) }))
      .filter(({ i, cur }) => cur && i.level && cur.level && i.level !== cur.level)
      .map(({ i, cur }) => ({ title: (cur!.original_title || cur!.title) as string, level: i.level as string }));
    if (changed.length) {
      const { data: settings } = await supabase.from("curation_settings").select("id, level_examples").limit(1).single();
      if (settings?.id) {
        const existing: { title: string; level: string }[] = Array.isArray(settings.level_examples) ? settings.level_examples : [];
        const titles = new Set(changed.map((c) => c.title));
        const next = [...changed, ...existing.filter((e) => !titles.has(e.title))].slice(0, 40);
        await supabase.from("curation_settings").update({ level_examples: next }).eq("id", settings.id);
      }
    }
  } catch (e) {
    console.warn("[save-curation] 레벨 사례 누적 실패(무시):", e);
  }

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
