import type { SupabaseClient } from "@supabase/supabase-js";

// 관리자 적합성 판정 사례 — curation_settings.fit_examples 에 쌓여 curate-v2 judgeFit 의 예시로 주입됨
//   good: 보드에서 "좋은 기사" 표시 / bad: "부적합" 표시 / manual: 직접 작성한 기사
export type FitExampleKind = "good" | "bad" | "manual";
export type FitExample = { title: string; fit: number; note?: string; kind: FitExampleKind; at: string };

const MAX_EXAMPLES = 80;   // 저장 상한 (프롬프트에는 이 중 최신 일부만 들어감 — curate-v2 pipeline 참고)
const FIT_BY_KIND: Record<FitExampleKind, number> = { good: 9, manual: 9, bad: 2 };

/** 사례 추가 — 같은 제목은 최신 판정으로 대체. 컬럼이 아직 없으면(11_fit_examples.sql 실행 전) 에러 메시지 반환 */
export async function addFitExample(
  supabase: SupabaseClient,
  ex: { title: string; kind: FitExampleKind; note?: string },
): Promise<string | null> {
  const title = ex.title.trim();
  if (!title) return null;
  const { data: settings, error } = await supabase.from("curation_settings").select("id, fit_examples").limit(1).single();
  if (error || !settings) return error?.message ?? "curation_settings 없음";
  const list: FitExample[] = Array.isArray(settings.fit_examples) ? settings.fit_examples : [];
  const entry: FitExample = {
    title, kind: ex.kind, fit: FIT_BY_KIND[ex.kind], at: new Date().toISOString(),
    ...(ex.note?.trim() && { note: ex.note.trim().slice(0, 80) }),
  };
  const next = [entry, ...list.filter((e) => e.title !== title)].slice(0, MAX_EXAMPLES);
  const { error: upErr } = await supabase.from("curation_settings").update({ fit_examples: next }).eq("id", settings.id);
  return upErr?.message ?? null;
}
