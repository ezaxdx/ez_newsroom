import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent } from "@/lib/event-score";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel cron 인증
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // cron 설정 조회
  const { data: settings } = await supabase
    .from("newsletter_cron_settings")
    .select("*")
    .single();

  if (!settings?.enabled) {
    return NextResponse.json({ skipped: true, reason: "auto-send disabled" });
  }

  // KST 기준 요일 · 시간 확인 (UTC+9)
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayDay  = nowKST.getUTCDay();    // 0=일, 1=월 ... 6=토
  const nowHourKST = nowKST.getUTCHours(); // KST 시(0-23)
  const sendHour  = settings.send_hour ?? 9; // 기본값 오전 9시

  if (todayDay !== settings.send_day) {
    return NextResponse.json({ skipped: true, reason: `오늘 요일 ${todayDay}, 설정 요일 ${settings.send_day}` });
  }
  if (nowHourKST !== sendHour) {
    return NextResponse.json({ skipped: true, reason: `현재 KST ${nowHourKST}시, 설정 시간 ${sendHour}시` });
  }

  // 콘텐츠 수집 (send route와 동일한 로직)
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const site_url = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";

  const { count: issueCount } = await supabase.from("newsletter_issues").select("*", { count: "exact", head: true });
  const vol_number = (issueCount ?? 0) + 1;

  const y = nowKST.getUTCFullYear();
  const mo = String(nowKST.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nowKST.getUTCDate()).padStart(2, "0");
  const send_date = `${y}.${mo}.${d}`;

  type RawNews = { id: string; title: string; summary_short: string; image_url: string | null; original_url: string };
  const toCard = (n: RawNews): NewsCard =>
    ({ title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url });

  // TOPNEWS 1건 + 최근 발행순 1건 수집
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
  const dayOfWeek = nowKST.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const { data: eventsPool } = await supabase.from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .lte("start_date", new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("start_date", { ascending: true }).limit(200);

  const scored = (eventsPool ?? [])
    .map((e) => ({
      ...e,
      _score: scoreEvent({
        event_name: e.event_name ?? "",
        event_name_en: e.event_name_en ?? null,
        category: e.category ?? null,
        industry: e.industry ?? null,
        organizer: e.organizer ?? null,
        venue: e.venue ?? "",
        start_date: e.start_date ?? todayStr,
      }, today),
    }))
    .sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  const featuredRaw = scored.slice(0, 4);
  const featuredEvents: EventCard[] = featuredRaw.map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null, image_url: null, website: e.website ?? null,
  }));

  const featuredIds = new Set(featuredRaw.map(e => e.id));
  const upcomingEvents: EventCard[] = scored
    .filter(e => !featuredIds.has(e.id) && e.start_date <= endOfWeekStr)
    .slice(0, 7)
    .map(e => ({
      name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
      venue: e.venue ?? null, website: e.website ?? null,
    }));

  const html = generateNewsletterHTML({
    vol_number, send_date,
    editorial_text: settings.default_editorial ?? "",
    mice_news: miceNews, tourism_news: tourismNews, ai_news: aiNews, ezpmp_news: ezpmpNews,
    featured_events: featuredEvents, upcoming_events: upcomingEvents,
    site_url,
  });

  // 수신자
  const { data: subscribers } = await supabase.from("newsletter_subscribers").select("email").eq("is_active", true);
  if (!subscribers || subscribers.length === 0) {
    return NextResponse.json({ skipped: true, reason: "no active subscribers" });
  }

  const subject = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";

  let total_sent = 0, total_failed = 0;
  const logEntries: { email: string; status: string; error_message: string | null }[] = [];

  try {
    const { results } = await sendNewsletterViaGmail({
      fromName: "EZ Letter",
      fromEmail,
      subject,
      html,
      recipients: subscribers.map(s => s.email),
    });
    for (const r of results) {
      if (r.status === "success") total_sent++;
      else total_failed++;
      logEntries.push(r);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const { data: issue } = await supabase.from("newsletter_issues")
    .insert({ vol_number, editorial_text: settings.default_editorial ?? "", status: "sent", total_sent, total_failed, sent_at: new Date().toISOString() })
    .select().single();

  if (issue && logEntries.length > 0) {
    await supabase.from("newsletter_send_logs").insert(logEntries.map(l => ({ ...l, issue_id: issue.id })));
  }

  return NextResponse.json({ ok: true, vol_number, total_sent, total_failed });
}
