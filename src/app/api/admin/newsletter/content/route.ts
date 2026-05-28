import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NewsCard, EventCard } from "@/lib/newsletter-template";

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

  // Vol number = existing issues count + 1
  const { count: issueCount } = await supabase
    .from("newsletter_issues")
    .select("*", { count: "exact", head: true });
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

  // Featured events (top 2)
  const { data: featuredRaw } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, venue, website")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .order("start_date", { ascending: true })
    .limit(2);

  const featuredEvents: EventCard[] = (featuredRaw ?? []).map((e) => ({
    name: e.event_name,
    start_date: e.start_date,
    venue: e.venue ?? null,
    image_url: null,
    website: e.website ?? null,
  }));

  const featuredIds = (featuredRaw ?? []).map((e) => e.id);

  // Upcoming events (next 7, excluding featured)
  const { data: upcomingRaw } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, venue, website")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .not("id", "in", featuredIds.length > 0 ? `(${featuredIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)")
    .order("start_date", { ascending: true })
    .limit(7);

  const upcomingEvents: EventCard[] = (upcomingRaw ?? []).map((e) => ({
    name: e.event_name,
    start_date: e.start_date,
    venue: e.venue ?? null,
    website: e.website ?? null,
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
