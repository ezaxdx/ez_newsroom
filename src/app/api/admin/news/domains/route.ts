import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

const VALID_DOMAINS = ["스마트립", "글로컬 관광", "AI 관광", "MICE Tech", "ATT(관광 전시)", "MEeT(의료 전시)", "AXDX"];
// 프롬프트에 실어 보낼 few-shot 예시 최대 개수 — 너무 많으면 토큰만 늘고 최신 보정 위주가 신호로서 더 유의미
const MAX_EXAMPLES = 40;

/** 관리자가 기사의 사업영역을 수동으로 보정 — 즉시 반영 + 향후 큐레이션 프롬프트의 few-shot 예시로 누적 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, title, business_domains } = await req.json();
  if (!id || !Array.isArray(business_domains)) {
    return NextResponse.json({ error: "id, business_domains 필요" }, { status: 400 });
  }
  const domains: string[] = business_domains.filter((d: unknown) => typeof d === "string" && VALID_DOMAINS.includes(d));

  const supabase = createAdminClient();

  const { error: updateError } = await supabase.from("news").update({ business_domains: domains }).eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // 확정 예시 누적 (같은 제목 재보정 시 기존 항목 대체, 최신순으로 최대 MAX_EXAMPLES개 유지)
  if (title) {
    const { data: settings } = await supabase.from("curation_settings").select("id, business_domain_examples").limit(1).single();
    const examples: { title: string; business_domains: string[] }[] = Array.isArray(settings?.business_domain_examples)
      ? settings.business_domain_examples : [];
    const filtered = examples.filter((e) => e.title !== title);
    const next = [{ title, business_domains: domains }, ...filtered].slice(0, MAX_EXAMPLES);
    if (settings?.id) {
      await supabase.from("curation_settings").update({ business_domain_examples: next }).eq("id", settings.id);
    }
  }

  return NextResponse.json({ ok: true });
}
