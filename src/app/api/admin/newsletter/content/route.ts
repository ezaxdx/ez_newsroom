import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent, WEEKLY_LIST_MIN_SCORE, WEEKLY_EXCLUDE_KEYWORDS } from "@/lib/event-score";
import { fetchOgImage } from "@/lib/fetch-og-image";
import { fillEventDescriptions } from "@/lib/generate-event-descriptions";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Vol number = 실제 발송 완료(status=sent)된 건수 + 1 (테스트/드래프트는 미포함)
  const { count: issueCount } = await supabase
    .from("newsletter_issues")
    .select("*", { count: "exact", head: true })
    .eq("status", "sent");
  const vol_number = (issueCount ?? 0) + 1;

  type RawNews = { id: string; title: string; summary_short: string; image_url: string | null; original_url: string };
  const toCard = (n: RawNews): NewsCard => ({ title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url });

  async function fetchCategoryNews(orFilter: string): Promise<NewsCard[]> {
    const { data: topRaw } = await supabase.from("news")
      .select("id, title, summary_short, image_url, original_url")
      .eq("is_published", true).or(orFilter)
      .order("display_order", { ascending: true }).limit(1);
    const top = (topRaw ?? []) as RawNews[];
    const excludeId = top[0]?.id ?? "00000000-0000-0000-0000-000000000000";
    const { data: latestRaw } = await supabase.from("news")
      .select("id, title, summary_short, image_url, original_url")
      .eq("is_published", true).gte("published_at", twoWeeksAgo)
      .or(orFilter).neq("id", excludeId)
      .order("published_at", { ascending: false }).limit(1);
    return [...top, ...(latestRaw ?? []) as RawNews[]].map(toCard);
  }

  const miceNews    = await fetchCategoryNews("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%");
  const tourismNews = await fetchCategoryNews("category.ilike.%TOURISM%,category.ilike.%관광%,category.ilike.%여행%");
  const aiNews      = await fetchCategoryNews("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%");
  const ezpmpNews   = await fetchCategoryNews("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%");

  // ── 행사 스코어링 ──
  const nowKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = nowKST.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const { data: eventsPool } = await supabase
    .from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url, description")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .lte("start_date", new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("start_date", { ascending: true })
    .limit(200);

  const scored = (eventsPool ?? [])
    .map((e) => ({ ...e, _score: scoreEvent({
      event_name: e.event_name ?? "",
      event_name_en: e.event_name_en ?? null,
      category: e.category ?? null,
      industry: e.industry ?? null,
      organizer: e.organizer ?? null,
      venue: e.venue ?? "",
      start_date: e.start_date ?? todayStr,
    }, today) }))
    .sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  // 스코어 상위 4개 선정 후 시작일 빠른 순 정렬
  const featuredRaw = scored.slice(0, 4).sort((a, b) => a.start_date.localeCompare(b.start_date));

  // description 없는 Pick 행사 → Gemini로 일괄 생성 + DB 캐시
  const descMap = await fillEventDescriptions(
    featuredRaw.map((e) => ({
      id: e.id,
      event_name: e.event_name,
      description: (e as { description?: string | null }).description ?? null,
      website: e.website ?? null,
      industry: e.industry ?? null,
      category: e.category ?? null,
      organizer: e.organizer ?? null,
    })),
    supabase,
    process.env.GOOGLE_AI_API_KEY
  );

  const featuredEvents: EventCard[] = await Promise.all(
    featuredRaw.map(async (e) => {
      const imageUrl = e.image_url ?? await fetchOgImage(e.website ?? null);
      return {
        name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
        venue: e.venue ?? null, image_url: imageUrl, website: e.website ?? null,
        description: descMap[e.id] ?? null,
      };
    })
  );

  const featuredIds = new Set(featuredRaw.map((e) => e.id));
  const upcomingEvents: EventCard[] = scored
    .filter((e) => {
      if (featuredIds.has(e.id)) return false;
      if (e.start_date > endOfWeekStr) return false;
      if (e._score < WEEKLY_LIST_MIN_SCORE) return false;
      const nameLower = (e.event_name ?? "").toLowerCase();
      if (WEEKLY_EXCLUDE_KEYWORDS.some((kw) => nameLower.includes(kw.toLowerCase()))) return false;
      return true;
    })
    .slice(0, 7)
    .map((e) => ({
      name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
      venue: e.venue ?? null, website: e.website ?? null,
    }));

  // Format send_date
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const send_date = `${y}.${m}.${d}`;

  return NextResponse.json({
    vol_number,
    send_date,
    mice_news: miceNews,
    tourism_news: tourismNews,
    ai_news: aiNews,
    ezpmp_news: ezpmpNews,
    featured_events: featuredEvents,
    upcoming_events: upcomingEvents,
  });
}
