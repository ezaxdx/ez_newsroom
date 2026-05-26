import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import fs from "fs";
import path from "path";

/* GET – 현재 카테고리 목록 + 카루셀 설정 + 페르소나 설정 */
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("curation_settings")
    .select("nav_categories, carousel_interval_sec, category_settings, level_prompts, auto_schedule, quality_thresholds, company_context")
    .limit(1)
    .single();

  return NextResponse.json({
    categories: data?.nav_categories ?? ["AI", "MICE", "TOURISM"],
    carouselSec: data?.carousel_interval_sec ?? 5,
    categorySettings: data?.category_settings ?? {},
    levelPrompts: data?.level_prompts ?? {},
    autoSchedule: data?.auto_schedule ?? { enabled: false, days: [], hour: 9 },
    qualityThresholds: data?.quality_thresholds ?? { auto_publish: 8, staging: 5 },
    companyContext: data?.company_context ?? "",
  });
}

/* POST – 카테고리 + 카루셀 + 페르소나 통합 저장 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const { categories, carouselSec, categorySettings, levelPrompts, autoSchedule, qualityThresholds, companyContext } = await req.json();
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("curation_settings")
    .select("id")
    .limit(1)
    .single();

  const payload = {
    nav_categories: categories,
    carousel_interval_sec: carouselSec,
    ...(categorySettings !== undefined && { category_settings: categorySettings }),
    ...(levelPrompts !== undefined && { level_prompts: levelPrompts }),
    ...(autoSchedule !== undefined && { auto_schedule: autoSchedule }),
    ...(qualityThresholds !== undefined && { quality_thresholds: qualityThresholds }),
    ...(companyContext !== undefined && { company_context: companyContext }),
  };

  if (existing?.id) {
    await supabase.from("curation_settings").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("curation_settings").insert(payload);
  }

  // company_context가 포함된 경우 docs/company_context.md에도 반영
  if (companyContext !== undefined) {
    try {
      const docsDir  = path.join(process.cwd(), "docs");
      const filePath = path.join(docsDir, "company_context.md");
      if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
      const content = `# EZPMP 회사 컨텍스트 (AI 큐레이션 시스템 프롬프트)\n\n> 이 파일은 관리자 설정 페이지에서 자동 생성됩니다. 직접 편집하지 마세요.\n> 마지막 업데이트: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n\n${companyContext}`;
      fs.writeFileSync(filePath, content, "utf-8");
    } catch (e) {
      // 파일 쓰기 실패는 무시 (DB 저장은 이미 완료)
      console.warn("[company_context] docs/company_context.md 파일 쓰기 실패:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
