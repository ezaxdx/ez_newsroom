import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EventCard } from "@/lib/newsletter-template";
import { fillEventDescriptions } from "@/lib/generate-event-descriptions";
import { loadScoringContext } from "@/lib/event-score-context";
import { liveRangeStart, selectNews, selectEvents } from "@/lib/newsletter-content";

export const dynamic = "force-dynamic";

// 발송 전 인트로 문구 작성을 돕는 미리보기 — 실제 발송(send/cron)과 같은 선정 로직(@/lib/newsletter-content)을 사용
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const today = new Date();

  // Vol number = 실제 발송 완료(status=sent)된 건수 + 1 (테스트/드래프트는 미포함)
  const { count: issueCount } = await supabase
    .from("newsletter_issues")
    .select("*", { count: "exact", head: true })
    .eq("status", "sent");
  const vol_number = (issueCount ?? 0) + 1;

  const news = await selectNews(supabase, await liveRangeStart(supabase));
  const scoring = await loadScoringContext(supabase);
  const { featuredRaw, upcoming, debug } = await selectEvents(supabase, { today, scoring });

  // description 없는 Pick 행사 → Gemini로 일괄 생성 + DB 캐시
  const descMap = await fillEventDescriptions(
    featuredRaw.map((e) => ({
      id: e.id, event_name: e.event_name, description: e.description, website: e.website,
      industry: e.industry ?? null, category: e.category ?? null, organizer: e.organizer ?? null,
    })),
    supabase,
    process.env.GOOGLE_AI_API_KEY
  );
  const featuredEvents: EventCard[] = featuredRaw.map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date, venue: e.venue,
    image_url: e.image_url, website: e.website, description: descMap[e.id] ?? null,
  }));

  const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const send_date = `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, "0")}.${String(kst.getUTCDate()).padStart(2, "0")}`;

  return NextResponse.json({
    vol_number, send_date,
    mice_news: news.mice, tourism_news: news.tourism, ai_news: news.ai, ezpmp_news: news.ezpmp,
    featured_events: featuredEvents, upcoming_events: upcoming,
    _debug: debug,
  });
}
