import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";
import nodemailer from "nodemailer";

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

  const toCard = (n: { title: string; summary_short: string; image_url: string | null; original_url: string }): NewsCard =>
    ({ title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url });

  // MICE 뉴스
  const { data: miceRaw } = await supabase.from("news_items")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true).gte("published_at", twoWeeksAgo)
    .or("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%")
    .order("published_at", { ascending: false }).limit(2);
  const miceNews: NewsCard[] = (miceRaw ?? []).map(toCard);

  // Tourism 뉴스
  const { data: tourismRaw } = await supabase.from("news_items")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true).gte("published_at", twoWeeksAgo)
    .or("category.ilike.%관광%,category.ilike.%여행%")
    .order("published_at", { ascending: false }).limit(2);
  const tourismNews: NewsCard[] = (tourismRaw ?? []).map(toCard);

  // AI 뉴스
  const { data: aiRaw } = await supabase.from("news_items")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true).gte("published_at", twoWeeksAgo)
    .or("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%")
    .order("published_at", { ascending: false }).limit(2);
  const aiNews: NewsCard[] = (aiRaw ?? []).map(toCard);

  // EZPMP 뉴스
  const { data: ezpmpRaw } = await supabase.from("news_items")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true).gte("published_at", twoWeeksAgo)
    .or("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%")
    .order("published_at", { ascending: false }).limit(2);
  const ezpmpNews: NewsCard[] = (ezpmpRaw ?? []).map(toCard);

  // ez letter Pick (featured 4개)
  const { data: featuredRaw } = await supabase.from("convention_events")
    .select("id, event_name, start_date, end_date, venue, website, image_url")
    .eq("is_published", true).gte("start_date", todayStr)
    .order("start_date", { ascending: true }).limit(4);
  const featuredEvents: EventCard[] = (featuredRaw ?? []).map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null,
    image_url: (e as { image_url?: string | null }).image_url ?? null,
    website: e.website ?? null,
  }));

  // Weekly Event List — 이번 주에 시작하거나 진행 중인 행사 (오늘 ~ 이번 주 일요일)
  const dayOfWeek = nowKST.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const featuredIds = (featuredRaw ?? []).map(e => e.id);
  const { data: upcomingRaw } = await supabase.from("convention_events")
    .select("id, event_name, start_date, end_date, venue, website")
    .eq("is_published", true)
    .lte("start_date", endOfWeekStr)
    .gte("end_date", todayStr)
    .not("id", "in", featuredIds.length > 0 ? `(${featuredIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)")
    .order("start_date", { ascending: true }).limit(20);
  const upcomingEvents: EventCard[] = (upcomingRaw ?? []).map(e => ({
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

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return NextResponse.json({ error: "Gmail env not set" }, { status: 500 });

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  });

  const subject = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  let total_sent = 0, total_failed = 0;
  const logEntries: { email: string; status: string; error_message: string | null }[] = [];

  for (const sub of subscribers) {
    try {
      await transporter.sendMail({ from: `"EZ Letter" <${gmailUser}>`, to: sub.email, subject, html });
      total_sent++;
      logEntries.push({ email: sub.email, status: "success", error_message: null });
    } catch (err) {
      total_failed++;
      logEntries.push({ email: sub.email, status: "failed", error_message: err instanceof Error ? err.message : String(err) });
    }
  }

  const { data: issue } = await supabase.from("newsletter_issues")
    .insert({ vol_number, editorial_text: settings.default_editorial ?? "", status: "sent", total_sent, total_failed, sent_at: new Date().toISOString() })
    .select().single();

  if (issue && logEntries.length > 0) {
    await supabase.from("newsletter_send_logs").insert(logEntries.map(l => ({ ...l, issue_id: issue.id })));
  }

  return NextResponse.json({ ok: true, vol_number, total_sent, total_failed });
}
