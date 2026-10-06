import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

const MAX_EXAMPLES = 40;

/**
 * 관리자가 기사의 카테고리를 직접 수정.
 *  - 카테고리만 바꾸거나, "그 관점으로 다시 쓴" 새 본문(title/summary_short/content_long/implications)과 함께 교체
 *  - 즉시 반영 + category_edited 표시 + curation_settings.category_examples 에 사례 누적
 *    (다음 큐레이션에서 카테고리를 AI가 판단할 때 few-shot 예시로 주입됨)
 *  - 본문을 교체하면 품질 감사를 다시 받도록 감사 필드를 초기화 (update-content 와 동일)
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, category, title, summary_short, content_long, implications } = await req.json();
  if (!id || typeof category !== "string") {
    return NextResponse.json({ error: "id, category 필요" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: settings } = await supabase.from("curation_settings").select("id, nav_categories, category_examples").limit(1).single();
  const valid = [...new Set([...(settings?.nav_categories ?? ["AI", "MICE", "TOURISM"]), "EZPMP"])];
  const cat = category.toUpperCase();
  if (!valid.includes(cat)) {
    return NextResponse.json({ error: `카테고리는 ${valid.join(", ")} 중 하나여야 합니다` }, { status: 400 });
  }

  const { data: before, error: readErr } = await supabase.from("news").select("title, original_title").eq("id", id).single();
  if (readErr || !before) return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });

  const rewriting = typeof title === "string" && typeof summary_short === "string" && typeof content_long === "string" && title.trim() && summary_short.trim() && content_long.trim();
  const { error } = await supabase.from("news").update({
    category: cat,
    category_edited: true,
    category_reason: null,
    ...(rewriting && {
      title: title.trim(), summary_short: summary_short.trim(), content_long: content_long.trim(),
      implications: typeof implications === "string" ? implications.trim() : null,
      audited_at: null, faithfulness_score: null, faithfulness_issues: null, audit_dismissed_at: null,
    }),
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 확정 사례 누적 (같은 제목은 대체, 최신순 최대 MAX_EXAMPLES개)
  const exTitle = (before.original_title || before.title) as string;
  if (settings?.id && exTitle) {
    const examples: { title: string; category: string }[] = Array.isArray(settings.category_examples) ? settings.category_examples : [];
    const next = [{ title: exTitle, category: cat }, ...examples.filter((e) => e.title !== exTitle)].slice(0, MAX_EXAMPLES);
    await supabase.from("curation_settings").update({ category_examples: next }).eq("id", settings.id);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, category: cat });
}
