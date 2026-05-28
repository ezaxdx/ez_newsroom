import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: { editorial_text?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const editorial_text = body.editorial_text ?? "";
  const dry_run = body.dry_run === true;

  const supabase = createAdminClient();
  const prod_url = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
  // 미리보기(dry_run)일 때는 요청 origin을 사용 → 로컬 개발 환경에서도 이미지 로드됨
  function getPreviewBase(): string {
    const originHeader = req.headers.get("origin");
    if (originHeader) return originHeader; // 브라우저가 보내는 origin 헤더 (가장 정확)
    const host = req.headers.get("host") ?? "";
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    return `${isLocal ? "http" : "https"}://${host}`;
  }
  const site_url = dry_run ? getPreviewBase() : prod_url;

  // ── Collect content ──
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { count: issueCount } = await supabase
    .from("newsletter_issues")
    .select("*", { count: "exact", head: true });
  const vol_number = (issueCount ?? 0) + 1;

  const y = today.getFullYear();
  const mo = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const send_date = `${y}.${mo}.${d}`;

  // ── 뉴스 수집 헬퍼 ──
  function toNewsCard(n: { title: string; summary_short: string; image_url: string | null; original_url: string }): NewsCard {
    return { title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url };
  }

  // MICE (없으면 빈 배열 → 섹션 자동 제거)
  const { data: miceRaw } = await supabase
    .from("news")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true)
    .gte("published_at", twoWeeksAgo)
    .or("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%")
    .order("published_at", { ascending: false })
    .limit(2);
  const miceNews: NewsCard[] = (miceRaw ?? []).map(toNewsCard);

  // Tourism
  const { data: tourismRaw } = await supabase
    .from("news")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true)
    .gte("published_at", twoWeeksAgo)
    .or("category.ilike.%관광%,category.ilike.%여행%")
    .order("published_at", { ascending: false })
    .limit(2);
  const tourismNews: NewsCard[] = (tourismRaw ?? []).map(toNewsCard);

  // AI
  const { data: aiRaw } = await supabase
    .from("news")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true)
    .gte("published_at", twoWeeksAgo)
    .or("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%")
    .order("published_at", { ascending: false })
    .limit(2);
  const aiNews: NewsCard[] = (aiRaw ?? []).map(toNewsCard);

  // EZPMP
  const { data: ezpmpRaw } = await supabase
    .from("news")
    .select("title, summary_short, image_url, original_url")
    .eq("is_published", true)
    .gte("published_at", twoWeeksAgo)
    .or("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%")
    .order("published_at", { ascending: false })
    .limit(2);
  const ezpmpNews: NewsCard[] = (ezpmpRaw ?? []).map(toNewsCard);

  // ez letter Pick (featured 4개) — image_url은 없을 수 있으므로 제외
  const { data: featuredRaw } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, end_date, venue, website")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .order("start_date", { ascending: true })
    .limit(4);

  const featuredEvents: EventCard[] = (featuredRaw ?? []).map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null, image_url: null, website: e.website ?? null,
  }));

  // Weekly Event List — 이번 주 (start_date 기준, end_date 없어도 동작)
  const nowKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = nowKST.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const featuredIds = (featuredRaw ?? []).map((e) => e.id);
  const { data: upcomingRaw } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, end_date, venue, website")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .lte("start_date", endOfWeekStr)
    .not("id", "in", featuredIds.length > 0 ? `(${featuredIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)")
    .order("start_date", { ascending: true })
    .limit(20);

  const upcomingEvents: EventCard[] = (upcomingRaw ?? []).map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null, website: e.website ?? null,
  }));

  const html = generateNewsletterHTML({
    vol_number,
    send_date,
    editorial_text,
    mice_news: miceNews,
    tourism_news: tourismNews,
    ai_news: aiNews,
    ezpmp_news: ezpmpNews,
    featured_events: featuredEvents,
    upcoming_events: upcomingEvents,
    site_url,
  });

  // ── Dry run: return preview HTML ──
  if (dry_run) {
    return NextResponse.json({ ok: true, html, vol_number, send_date });
  }

  // ── Real send ──
  const { data: subscribers } = await supabase
    .from("newsletter_subscribers")
    .select("email")
    .eq("is_active", true);

  if (!subscribers || subscribers.length === 0) {
    return NextResponse.json({ error: "활성 수신자가 없습니다." }, { status: 400 });
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    return NextResponse.json({ error: "GMAIL_USER / GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다." }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  });

  const subject = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  let total_sent = 0;
  let total_failed = 0;
  const errors: { email: string; error: string }[] = [];
  const logEntries: { email: string; status: string; error_message: string | null }[] = [];

  for (const sub of subscribers) {
    try {
      await transporter.sendMail({
        from: `"EZ Letter" <${gmailUser}>`,
        to: sub.email,
        subject,
        html,
      });
      total_sent++;
      logEntries.push({ email: sub.email, status: "success", error_message: null });
    } catch (err) {
      total_failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ email: sub.email, error: errMsg });
      logEntries.push({ email: sub.email, status: "failed", error_message: errMsg });
    }
  }

  // Save issue
  const { data: issue, error: issueErr } = await supabase
    .from("newsletter_issues")
    .insert({
      vol_number,
      editorial_text,
      status: "sent",
      total_sent,
      total_failed,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (issueErr) {
    return NextResponse.json({ error: issueErr.message }, { status: 500 });
  }

  // Save logs
  if (logEntries.length > 0) {
    await supabase.from("newsletter_send_logs").insert(
      logEntries.map((l) => ({ ...l, issue_id: issue.id }))
    );
  }

  return NextResponse.json({ ok: true, vol_number, total_sent, total_failed, errors });
}
