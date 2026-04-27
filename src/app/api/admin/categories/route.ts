import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* GET – 현재 카테고리 목록 + 카루셀 설정 + 페르소나 설정 */
export async function GET() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("curation_settings")
    .select("nav_categories, carousel_interval_sec, category_settings, level_prompts, auto_schedule, quality_thresholds")
    .limit(1)
    .single();

  return NextResponse.json({
    categories: data?.nav_categories ?? ["AI", "MICE", "TOURISM"],
    carouselSec: data?.carousel_interval_sec ?? 5,
    categorySettings: data?.category_settings ?? {},
    levelPrompts: data?.level_prompts ?? {},
    autoSchedule: data?.auto_schedule ?? { enabled: false, days: [], hour: 9 },
    qualityThresholds: data?.quality_thresholds ?? { auto_publish: 8, staging: 5 },
  });
}

/* POST – 카테고리 + 카루셀 + 페르소나 통합 저장 */
export async function POST(req: NextRequest) {
  const { categories, carouselSec, categorySettings, levelPrompts, autoSchedule, qualityThresholds } = await req.json();
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
  };

  if (existing?.id) {
    await supabase.from("curation_settings").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("curation_settings").insert(payload);
  }

  return NextResponse.json({ ok: true });
}
