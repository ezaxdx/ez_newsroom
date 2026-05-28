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

  // MICE news
  const { data: miceRaw } = await supabase
    .from("news_items")
    .select("id, title, summary_short, image_url, original_url, category, published_at")
    .eq("is_published", true)
    .gte("published_at", twoWeeksAgo)
    .or("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%")
    .order("published_at", { ascending: false })
    .limit(2);

  let miceNews: NewsCard[] = (miceRaw ?? []).map((n) => ({
    title: n.title,
    summary: n.summary_short,
    image_url: n.image_url,
    url: n.original_url,
  }));

  // Fill MICE if needed
  if (miceNews.length < 2) {
    const needed = 2 - miceNews.length;
    const existingIds = (miceRaw ?? []).map((n) => n.id);
    const { data: fallback } = await supabase
      .from("news_items")
      .select("id, title, summary_short, image_url, original_url, category, published_at")
      .eq("is_published", true)
      .not("id", "in", existingIds.length > 0 ? `(${existingIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)")
      .order("published_at", { ascending: false })
      .limit(needed);

    const extra: NewsCard[] = (fallback ?? []).map((n) => ({
      title: n.title,
      summary: n.summary_short,
      image_url: n.image_url,
      url: n.original_url,
    }));
    miceNews = [...miceNews, ...extra];
  }

  // Tourism news
  const { data: tourismRaw } = await supabase
    .from("news_items")
    .select("id, title, summary_short, image_url, original_url, category, published_at")
    .eq("is_published", true)
    .gte("published_at", twoWeeksAgo)
    .or("category.ilike.%관광%,category.ilike.%여행%")
    .order("published_at", { ascending: false })
    .limit(2);

  let tourismNews: NewsCard[] = (tourismRaw ?? []).map((n) => ({
    title: n.title,
    summary: n.summary_short,
    image_url: n.image_url,
    url: n.original_url,
  }));

  // Fill Tourism if needed
  if (tourismNews.length < 2) {
    const needed = 2 - tourismNews.length;
    const existingIds = [
      ...(miceRaw ?? []).map((n) => n.id),
      ...(tourismRaw ?? []).map((n) => n.id),
    ];
    const { data: fallback } = await supabase
      .from("news_items")
      .select("id, title, summary_short, image_url, original_url, category, published_at")
      .eq("is_published", true)
      .not("id", "in", existingIds.length > 0 ? `(${existingIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)")
      .order("published_at", { ascending: false })
      .limit(needed);

    const extra: NewsCard[] = (fallback ?? []).map((n) => ({
      title: n.title,
      summary: n.summary_short,
      image_url: n.image_url,
      url: n.original_url,
    }));
    tourismNews = [...tourismNews, ...extra];
  }

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
    featured_events: featuredEvents,
    upcoming_events: upcomingEvents,
  });
}
