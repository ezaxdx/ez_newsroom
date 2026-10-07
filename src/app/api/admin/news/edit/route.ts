import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const MAX_LEVEL_EXAMPLES = 30;   // AI 레벨 판정 프롬프트에 그대로 들어가는 개수와 같게

/**
 * 큐레이션 보드에서 관리자가 기사 내용을 직접 수정 — 제목/요약/시사점/이미지와 레벨.
 * 본문(content_long)은 상세 편집이 필요해 대상에서 제외(필요하면 정합성 관리의
 * 콘텐츠 감사 수정 화면 사용). 카테고리는 /api/admin/news/category 가 담당.
 * 레벨이 실제로 바뀌면 (원문 제목, 레벨)을 curation_settings.level_examples 에 쌓아 다음 큐레이션의 레벨 판정 예시로 쓴다.
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, title, summary_short, implications, image_url, level } = await req.json();
  if (!id || typeof title !== "string" || !title.trim() || typeof summary_short !== "string" || !summary_short.trim()) {
    return NextResponse.json({ error: "id, title, summary_short 필요" }, { status: 400 });
  }
  if (level !== undefined && !LEVELS.includes(level)) {
    return NextResponse.json({ error: "level 은 Beginner·Intermediate·Advanced 중 하나" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // 레벨이 바뀌는지 비교하려고 현재 값을 먼저 읽음
  const { data: before } = level !== undefined
    ? await supabase.from("news").select("level, title, original_title").eq("id", id).single()
    : { data: null };

  const { error } = await supabase.from("news").update({
    title: title.trim(),
    summary_short: summary_short.trim(),
    implications: typeof implications === "string" ? implications.trim() : null,
    image_url: typeof image_url === "string" && image_url.trim() ? image_url.trim() : null,
    ...(level !== undefined && { level }),
  }).eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 레벨 사례 누적 — 실패해도 저장 자체는 성공으로 처리 (level_examples 컬럼이 없어도 무방)
  if (before && before.level && before.level !== level) {
    try {
      const exTitle = (before.original_title || before.title) as string;
      const { data: settings } = await supabase.from("curation_settings").select("id, level_examples").limit(1).single();
      if (settings?.id && exTitle) {
        const existing: { title: string; level: string }[] = Array.isArray(settings.level_examples) ? settings.level_examples : [];
        const next = [{ title: exTitle, level }, ...existing.filter((e) => e.title !== exTitle)].slice(0, MAX_LEVEL_EXAMPLES);
        await supabase.from("curation_settings").update({ level_examples: next }).eq("id", settings.id);
      }
    } catch (e) {
      console.warn("[news/edit] 레벨 사례 누적 실패(무시):", e);
    }
  }
  return NextResponse.json({ ok: true });
}
