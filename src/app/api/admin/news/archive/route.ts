import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { NEWS_CARD_COLUMNS, toCardItem } from "@/lib/admin-news";

export const dynamic = "force-dynamic";

/**
 * 큐레이션 보드 아카이브 탭 — "더 보기"로 나눠 읽기.
 * GET ?before=ISO(기준 시각 — 이 시각 이전 발행분이 아카이브) &cat=카테고리(생략·ALL=전체) &offset=0 &limit=30
 * → { items, total }  (발행 시각 최신순, 같은 시각이면 id 순)
 */
export async function GET(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const sp = req.nextUrl.searchParams;
  const before = sp.get("before");
  if (!before || Number.isNaN(Date.parse(before))) return NextResponse.json({ error: "before(ISO 시각) 필요" }, { status: 400 });
  const cat = sp.get("cat");
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 30) || 30));

  const supabase = createAdminClient();
  let q = supabase.from("news").select(NEWS_CARD_COLUMNS, { count: "exact" })
    .eq("is_published", true).lt("published_at", before);
  if (cat && cat !== "ALL") q = q.eq("category", cat);
  const { data, count, error } = await q
    .order("published_at", { ascending: false }).order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []).map((r) => toCardItem(r as unknown as Record<string, unknown>)), total: count ?? 0 });
}
