import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

const MAX_NOTES = 30;

/**
 * 콘텐츠 품질 감사에서 걸린 기사를 관리자가 직접(또는 AI 제안을 검토해) 수정 저장.
 * 저장 시 그 기사에 걸려있던 문제점을 curation_settings.content_quality_notes에 누적 —
 * "실제로 고쳐진 문제"만 기록되므로 감사 오탐(false positive)이 섞여 들어가지 않음.
 * 재감사 대상으로 돌아가도록 audited_at 등 감사 필드는 초기화.
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, title, summary_short, content_long, implications } = await req.json();
  if (!id || !title || !summary_short || !content_long) {
    return NextResponse.json({ error: "id, title, summary_short, content_long 필요" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: before } = await supabase.from("news").select("faithfulness_issues").eq("id", id).single();
  const priorIssues: string[] = Array.isArray(before?.faithfulness_issues) ? before.faithfulness_issues : [];

  const { error: updateError } = await supabase.from("news").update({
    title, summary_short, content_long,
    implications: implications ?? null,
    audited_at: null, faithfulness_score: null, faithfulness_issues: null,
  }).eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (priorIssues.length) {
    const { data: settings } = await supabase.from("curation_settings").select("id, content_quality_notes").limit(1).single();
    const existing: string[] = Array.isArray(settings?.content_quality_notes) ? settings.content_quality_notes : [];
    const merged = [...new Set([...priorIssues, ...existing])].slice(0, MAX_NOTES);
    if (settings?.id) {
      await supabase.from("curation_settings").update({ content_quality_notes: merged }).eq("id", settings.id);
    }
  }

  return NextResponse.json({ ok: true });
}
