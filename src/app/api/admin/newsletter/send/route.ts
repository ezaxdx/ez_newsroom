import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent, WEEKLY_LIST_MIN_SCORE, WEEKLY_EXCLUDE_KEYWORDS } from "@/lib/event-score";
import { getGmailClient, makeRawMessage } from "@/lib/gmail-sender";

export const maxDuration = 60;

// ── 배치 발송 + 즉시 로그 저장 헬퍼 ──────────────────────
// Vercel 60초 타임아웃 중간에 끊겨도 완료된 배치의 로그는 보존됨
async function sendAndSaveLogs({
  supabase, issueId, html, subject, fromEmail, recipients,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  issueId: string;
  html: string;
  subject: string;
  fromEmail: string;
  recipients: string[];
}): Promise<{ total_sent: number; total_failed: number }> {
  const gmail = await getGmailClient();
  const from = `"EZ Letter" <${fromEmail}>`;
  const BATCH_SIZE = 5;
  let total_sent = 0, total_failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    if (i > 0) await new Promise(r => setTimeout(r, 200));

    const batchResults = await Promise.all(
      batch.map(async (to) => {
        try {
          const raw = makeRawMessage({ from, to, subject, html });
          await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
          return { email: to, status: "success" as const, error_message: null };
        } catch (err) {
          return {
            email: to, status: "failed" as const,
            error_message: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    // 배치 완료 즉시 DB에 저장 (타임아웃으로 끊겨도 이전 배치는 보존)
    await supabase.from("newsletter_send_logs").insert(
      batchResults.map(r => ({ ...r, issue_id: issueId }))
    );

    total_sent  += batchResults.filter(r => r.status === "success").length;
    total_failed += batchResults.filter(r => r.status === "failed").length;
  }

  return { total_sent, total_failed };
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: {
    editorial_text?: string; dry_run?: boolean;
    cached_html?: string; cached_vol?: number; cached_send_date?: string; cached_featured_ids?: string[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const editorial_text = body.editorial_text ?? "";
  const dry_run = body.dry_run === true;
  const supabase = createAdminClient();

  // ── 미리보기에서 생성된 HTML 캐시로 바로 발송 ──────────
  if (!dry_run && body.cached_html) {
    const { data: subscribers } = await supabase
      .from("newsletter_subscribers").select("email").eq("is_active", true);
    if (!subscribers || subscribers.length === 0)
      return NextResponse.json({ error: "활성 수신자가 없습니다." }, { status: 400 });

    const vol_number = body.cached_vol ?? 1;
    const send_date  = body.cached_send_date ?? new Date().toISOString().split("T")[0];
    const subject    = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
    const fromEmail  = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";

    // 미리보기 HTML 후처리: localhost → prod URL (프록시 유지 — 이메일 클라이언트 호환성)
    const prodUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
    const sendHtml = body.cached_html
      .replace(/https?:\/\/localhost:\d+/g, prodUrl);

    const recipients = subscribers.map(s => s.email);

    // 이슈를 먼저 생성 (status: sending) → 타임아웃으로 끊겨도 이슈 기록 남음
    const { data: issue, error: issueErr } = await supabase
      .from("newsletter_issues")
      .insert({
        vol_number, editorial_text, status: "sending",
        html_content: sendHtml,
        target_count: recipients.length,
        total_sent: 0, total_failed: 0,
        sent_at: new Date().toISOString(),
        featured_event_ids: body.cached_featured_ids ?? [],
      })
      .select().single();

    if (issueErr || !issue)
      return NextResponse.json({ error: issueErr?.message ?? "이슈 생성 실패" }, { status: 500 });

    const { total_sent, total_failed } = await sendAndSaveLogs({
      supabase, issueId: issue.id, html: sendHtml,
      subject, fromEmail, recipients,
    });

    const finalStatus = total_sent === 0 ? "failed" : total_failed === 0 ? "sent" : "partial";
    await supabase.from("newsletter_issues")
      .update({ status: finalStatus, total_sent, total_failed })
      .eq("id", issue.id);

    return NextResponse.json({ ok: true, vol_number, total_sent, total_failed });
  }

  // ── 콘텐츠 생성 (미리보기 or 캐시 없는 발송) ────────────
  const prod_url = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
  function getPreviewBase(): string {
    const originHeader = req.headers.get("origin");
    if (originHeader) return originHeader;
    const host = req.headers.get("host") ?? "";
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    return `${isLocal ? "http" : "https"}://${host}`;
  }
  const site_url = dry_run ? getPreviewBase() : prod_url;

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Vol number: 오늘(KST) 이미 발송된 호가 있으면 같은 Vol 재사용
  const todayKST    = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayKSTStr = todayKST.toISOString().split("T")[0];
  const kstDayStart = new Date(`${todayKSTStr}T00:00:00+09:00`).toISOString();
  const kstDayEnd   = new Date(`${todayKSTStr}T23:59:59+09:00`).toISOString();

  const { data: todayIssues } = await supabase
    .from("newsletter_issues").select("vol_number")
    .in("status", ["sent", "partial", "sending"])
    .gte("sent_at", kstDayStart).lte("sent_at", kstDayEnd)
    .order("sent_at", { ascending: true }).limit(1);

  const { data: maxVolData } = await supabase
    .from("newsletter_issues")
    .select("vol_number")
    .in("status", ["sent", "partial"])
    .order("vol_number", { ascending: false })
    .limit(1);

  const maxVol = maxVolData?.[0]?.vol_number ?? 0;
  const vol_number = todayIssues?.[0]?.vol_number ?? maxVol + 1;

  // send_date는 KST 기준
  const [ky, km, kd] = todayKSTStr.split("-");
  const send_date = `${ky}.${km}.${kd}`;

  // ── 뉴스 수집 ──
  type RawNews = { id: string; title: string; summary_short: string; image_url: string | null; original_url: string };
  function toNewsCard(n: RawNews): NewsCard {
    return { title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url };
  }
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
    return [...top, ...(latestRaw ?? []) as RawNews[]].map(toNewsCard);
  }

  const [miceNews, tourismNews, aiNews, ezpmpNews] = await Promise.all([
    fetchCategoryNews("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%"),
    fetchCategoryNews("category.ilike.%TOURISM%,category.ilike.%관광%,category.ilike.%여행%"),
    fetchCategoryNews("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%"),
    fetchCategoryNews("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%"),
  ]);

  // ── 행사 스코어링 ──
  const nowKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = nowKST.getUTCDay();
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + (dayOfWeek === 0 ? 0 : 7 - dayOfWeek));
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];
  const ninetyDaysLater = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const { data: eventsPool } = await supabase.from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url, description")
    .eq("is_published", true).neq("is_concurrent", true)
    .gte("start_date", todayStr).lte("start_date", ninetyDaysLater)
    .order("start_date", { ascending: true }).limit(200);

  const scoredAll = (eventsPool ?? []).map(e => ({
    ...e,
    _score: scoreEvent({
      event_name: e.event_name ?? "", event_name_en: e.event_name_en ?? null,
      category: e.category ?? null, industry: e.industry ?? null,
      organizer: e.organizer ?? null, venue: e.venue ?? "",
      start_date: e.start_date ?? todayStr,
    }, today),
  })).sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  function normalizeVenue(venue: string): string {
    return venue.replace(/\(.*?\)/g, "").replace(/[A-Za-z]/g, "").replace(/\s+/g, "").trim();
  }
  const venueDateMap = new Map<string, typeof scoredAll[number]>();
  for (const e of scoredAll) {
    const key = `${normalizeVenue(e.venue ?? "")}:${e.start_date ?? ""}`;
    if (!venueDateMap.has(key)) venueDateMap.set(key, e);
  }
  const scored = Array.from(venueDateMap.values())
    .sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  const { data: recentIssues } = await supabase.from("newsletter_issues")
    .select("featured_event_ids").in("status", ["sent", "partial"])
    .order("sent_at", { ascending: false }).limit(2);
  const recentlyFeatured = new Set<string>(
    (recentIssues ?? []).flatMap(i => (i.featured_event_ids as string[] | null) ?? [])
  );

  const d14 = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const fresh = scored.filter(e => !recentlyFeatured.has(e.id));
  const seenIds = new Set<string>(); const pickPool: typeof fresh = [];
  for (const e of [
    ...fresh.filter(e => e.start_date <= d14),
    ...fresh.filter(e => e.start_date > d14 && e.start_date <= d30),
    ...fresh.filter(e => e.start_date > d30),
    ...scored,
  ]) {
    if (pickPool.length >= 4) break;
    if (!seenIds.has(e.id)) { seenIds.add(e.id); pickPool.push(e); }
  }
  const featuredRaw = pickPool.slice(0, 4).sort((a, b) => a.start_date.localeCompare(b.start_date));

  const featuredEvents: EventCard[] = featuredRaw.map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null,
    image_url: (e as { image_url?: string | null }).image_url ?? null,
    website: e.website ?? null,
    description: (e as { description?: string | null }).description ?? null,
  }));

  const featuredIds = new Set(featuredRaw.map(e => e.id));
  const upcomingEvents: EventCard[] = scored.filter(e => {
    if (featuredIds.has(e.id)) return false;
    if (e.start_date > endOfWeekStr) return false;
    if (e._score < WEEKLY_LIST_MIN_SCORE) return false;
    const nl = (e.event_name ?? "").toLowerCase();
    if (WEEKLY_EXCLUDE_KEYWORDS.some(kw => nl.includes(kw.toLowerCase()))) return false;
    return true;
  }).slice(0, 7).map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null, website: e.website ?? null,
  }));

  const html = generateNewsletterHTML({
    vol_number, send_date, editorial_text,
    mice_news: miceNews, tourism_news: tourismNews, ai_news: aiNews, ezpmp_news: ezpmpNews,
    featured_events: featuredEvents, upcoming_events: upcomingEvents,
    site_url, is_email: !dry_run,
  });

  // ── 미리보기 반환 ──
  if (dry_run) {
    return NextResponse.json({ ok: true, html, vol_number, send_date, featured_ids: featuredRaw.map(e => e.id) });
  }

  // ── 실제 발송 ──
  const { data: subscribers } = await supabase
    .from("newsletter_subscribers").select("email").eq("is_active", true);
  if (!subscribers || subscribers.length === 0)
    return NextResponse.json({ error: "활성 수신자가 없습니다." }, { status: 400 });

  const subject   = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  const recipients = subscribers.map(s => s.email);

  const { data: issue, error: issueErr } = await supabase
    .from("newsletter_issues")
    .insert({
      vol_number, editorial_text, status: "sending",
      html_content: html,
      target_count: recipients.length,
      total_sent: 0, total_failed: 0,
      sent_at: new Date().toISOString(),
      featured_event_ids: featuredRaw.map(e => e.id),
    })
    .select().single();

  if (issueErr || !issue)
    return NextResponse.json({ error: issueErr?.message ?? "이슈 생성 실패" }, { status: 500 });

  const { total_sent, total_failed } = await sendAndSaveLogs({
    supabase, issueId: issue.id, html,
    subject, fromEmail, recipients,
  });

  const finalStatus = total_sent === 0 ? "failed" : total_failed === 0 ? "sent" : "partial";
  await supabase.from("newsletter_issues")
    .update({ status: finalStatus, total_sent, total_failed })
    .eq("id", issue.id);

  return NextResponse.json({ ok: true, vol_number, total_sent, total_failed });
}
