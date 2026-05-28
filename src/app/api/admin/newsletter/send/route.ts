import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent } from "@/lib/event-score";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";

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
  type RawNews = { id: string; title: string; summary_short: string; image_url: string | null; original_url: string };
  function toNewsCard(n: RawNews): NewsCard {
    return { title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url };
  }

  // TOPNEWS 1건 + 최근 발행순 1건 수집
  async function fetchCategoryNews(orFilter: string): Promise<NewsCard[]> {
    // ① TOPNEWS: display_order 가장 낮은 1건
    const { data: topRaw } = await supabase
      .from("news")
      .select("id, title, summary_short, image_url, original_url")
      .eq("is_published", true)
      .or(orFilter)
      .order("display_order", { ascending: true })
      .limit(1);
    const top = (topRaw ?? []) as RawNews[];

    // ② 최근 발행순 1건 (TOPNEWS와 중복 제외)
    const excludeId = top[0]?.id ?? "00000000-0000-0000-0000-000000000000";
    const { data: latestRaw } = await supabase
      .from("news")
      .select("id, title, summary_short, image_url, original_url")
      .eq("is_published", true)
      .gte("published_at", twoWeeksAgo)
      .or(orFilter)
      .neq("id", excludeId)
      .order("published_at", { ascending: false })
      .limit(1);
    const latest = (latestRaw ?? []) as RawNews[];

    return [...top, ...latest].map(toNewsCard);
  }

  const miceNews    = await fetchCategoryNews("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%");
  const tourismNews = await fetchCategoryNews("category.ilike.%TOURISM%,category.ilike.%관광%,category.ilike.%여행%");
  const aiNews      = await fetchCategoryNews("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%");
  const ezpmpNews   = await fetchCategoryNews("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%");

  // ── 행사 스코어링 공통 ──
  const nowKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = nowKST.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  // 후보 행사 풀 (90일 이내, score 계산용 컬럼 포함)
  const ninetyDaysLater = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const { data: eventsPool, error: eventsError } = await supabase
    .from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url")
    .eq("is_published", true)
    .gte("start_date", todayStr)
    .lte("start_date", ninetyDaysLater)
    .order("start_date", { ascending: true })
    .limit(200);

  // 쿼리 실패 시 basic 컬럼으로 fallback
  const eventsData = eventsPool ?? (eventsError ? [] : []);
  const scored = eventsData
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

  // ez letter Pick: 스코어 top 4
  const featuredRaw = scored.slice(0, 4);
  const featuredEvents: EventCard[] = featuredRaw.map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null, image_url: e.image_url ?? null, website: e.website ?? null,
  }));

  // Weekly Event List: 이번 주 행사 중 스코어 순 (Pick 제외)
  const featuredIds = new Set(featuredRaw.map((e) => e.id));
  const upcomingEvents: EventCard[] = scored
    .filter((e) => !featuredIds.has(e.id) && e.start_date <= endOfWeekStr)
    .slice(0, 7)
    .map((e) => ({
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

  const subject = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";

  let total_sent = 0;
  let total_failed = 0;
  const errors: { email: string; error: string }[] = [];
  const logEntries: { email: string; status: string; error_message: string | null }[] = [];

  try {
    const { results } = await sendNewsletterViaGmail({
      fromName: "EZ Letter",
      fromEmail,
      subject,
      html,
      recipients: subscribers.map((s) => s.email),
    });
    for (const r of results) {
      if (r.status === "success") total_sent++;
      else {
        total_failed++;
        errors.push({ email: r.email, error: r.error_message ?? "unknown" });
      }
      logEntries.push(r);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
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
