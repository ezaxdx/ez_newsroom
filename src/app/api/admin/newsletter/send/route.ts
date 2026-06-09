import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent, WEEKLY_LIST_MIN_SCORE, WEEKLY_EXCLUDE_KEYWORDS } from "@/lib/event-score";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";
import { fetchEventImage } from "@/lib/fetch-event-image";
import { fillEventDescriptions } from "@/lib/generate-event-descriptions";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  let body: { editorial_text?: string; dry_run?: boolean; cached_html?: string; cached_vol?: number; cached_send_date?: string; cached_featured_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const editorial_text = body.editorial_text ?? "";
  const dry_run = body.dry_run === true;

  // 미리보기에서 생성된 HTML이 있으면 콘텐츠 재생성 스킵하고 바로 발송
  if (!dry_run && body.cached_html) {
    const supabaseFast = createAdminClient();
    const { data: subscribers } = await supabaseFast
      .from("newsletter_subscribers")
      .select("email")
      .eq("is_active", true);
    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ error: "활성 수신자가 없습니다." }, { status: 400 });
    }
    const vol_number = body.cached_vol ?? 1;
    const send_date = body.cached_send_date ?? new Date().toISOString().split("T")[0];
    const subject = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
    const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
    // 미리보기 HTML 후처리:
    // 1. localhost URL → production URL 교체
    // 2. /api/image-proxy?url=... 프록시 래퍼를 원본 URL로 복원 (이메일은 직접 외부 URL 사용)
    const prodUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
    const sendHtml = body.cached_html
      .replace(/https?:\/\/localhost:\d+/g, prodUrl)
      .replace(/https?:\/\/[^/]+\/api\/image-proxy\?url=([^"'\s&]+)/g,
        (_: string, encoded: string) => decodeURIComponent(encoded));
    const { results } = await sendNewsletterViaGmail({
      fromName: "EZ Letter", fromEmail, subject,
      html: sendHtml,
      recipients: subscribers.map((s) => s.email),
    });
    let total_sent = 0, total_failed = 0;
    const logEntries = [];
    for (const r of results) {
      if (r.status === "success") total_sent++; else total_failed++;
      logEntries.push(r);
    }
    const { data: issue } = await supabaseFast.from("newsletter_issues").insert({
      vol_number, editorial_text, status: "sent",
      total_sent, total_failed, sent_at: new Date().toISOString(),
      featured_event_ids: body.cached_featured_ids ?? [],
    }).select().single();
    if (issue && logEntries.length > 0) {
      await supabaseFast.from("newsletter_send_logs").insert(
        logEntries.map((l) => ({ ...l, issue_id: issue.id }))
      );
    }
    return NextResponse.json({ ok: true, vol_number, total_sent, total_failed });
  }

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

  // Vol number: 오늘(KST) 이미 발송된 호가 있으면 같은 Vol 재사용, 없으면 새 번호
  // → 같은 날 분할발송·재발송해도 Vol이 증가하지 않음
  const todayKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayKSTStr = todayKST.toISOString().split("T")[0];
  const kstDayStart = new Date(`${todayKSTStr}T00:00:00+09:00`).toISOString();
  const kstDayEnd   = new Date(`${todayKSTStr}T23:59:59+09:00`).toISOString();

  const { data: todayIssues } = await supabase
    .from("newsletter_issues")
    .select("vol_number")
    .eq("status", "sent")
    .gte("sent_at", kstDayStart)
    .lte("sent_at", kstDayEnd)
    .order("sent_at", { ascending: true })
    .limit(1);

  const { count: issueCount } = await supabase
    .from("newsletter_issues")
    .select("*", { count: "exact", head: true })
    .eq("status", "sent");

  // 오늘 발송분 있으면 그 Vol 사용, 없으면 전체 발송 횟수 + 1
  const vol_number = todayIssues?.[0]?.vol_number ?? (issueCount ?? 0) + 1;

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
  const { data: eventsPool } = await supabase
    .from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url, description")
    .eq("is_published", true)
    .neq("is_concurrent", true)   // 동시개최 행사 제외 (메인 행사만)
    .gte("start_date", todayStr)
    .lte("start_date", ninetyDaysLater)
    .order("start_date", { ascending: true })
    .limit(200);

  const scoredAll = (eventsPool ?? [])
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

  // 동시개최 중복 제거: 같은 venue + start_date 조합은 점수 1위만 남김
  function normalizeVenue(venue: string): string {
    return venue
      .replace(/\(.*?\)/g, "")
      .replace(/[A-Za-z]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }
  const venueDateMap = new Map<string, typeof scoredAll[number]>();
  for (const e of scoredAll) {
    const key = `${normalizeVenue(e.venue ?? "")}:${e.start_date ?? ""}`;
    if (!venueDateMap.has(key)) venueDateMap.set(key, e);
  }
  const scored = Array.from(venueDateMap.values())
    .sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  // 최근 2개 발송 호에 나온 Pick 행사 제외 (중복 방지)
  const { data: recentIssues } = await supabase
    .from("newsletter_issues")
    .select("featured_event_ids")
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(2);
  const recentlyFeatured = new Set<string>(
    (recentIssues ?? []).flatMap(i => (i.featured_event_ids as string[] | null) ?? [])
  );

  // Pick 선정: 14일 이내 우선 → 부족하면 30일 이내 보충 → 그래도 부족하면 90일 전체로 보충
  const d14 = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const fresh = scored.filter(e => !recentlyFeatured.has(e.id));
  const near = fresh.filter(e => e.start_date <= d14);
  const mid  = fresh.filter(e => e.start_date > d14 && e.start_date <= d30);
  const far  = fresh.filter(e => e.start_date > d30);
  const seenIds = new Set<string>();
  const pickPool: typeof fresh = [];
  for (const e of [...near, ...mid, ...far, ...scored]) {
    if (pickPool.length >= 4) break;
    if (!seenIds.has(e.id)) { seenIds.add(e.id); pickPool.push(e); }
  }
  const featuredRaw = pickPool.slice(0, 4).sort((a, b) => a.start_date.localeCompare(b.start_date));

  // 발송 시: 외부 API 호출 없이 DB 값만 사용 (Gemini·네이버 스킵 → 타임아웃 방지)
  // description·image_url이 없으면 null로 처리 (미리보기에서 이미 캐시됨)
  const featuredEvents: EventCard[] = featuredRaw.map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null,
    image_url: (e as { image_url?: string | null }).image_url ?? null,
    website: e.website ?? null,
    description: (e as { description?: string | null }).description ?? null,
  }));

  // Weekly Event List: 이번 주 행사 중 스코어 순 (Pick 제외, 최소 스코어 + 제외 키워드 필터)
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
    is_email: !dry_run, // 미리보기는 false(프록시 사용), 발송은 true(원본 URL)
  });

  // ── Dry run: return preview HTML ──
  if (dry_run) {
    return NextResponse.json({ ok: true, html, vol_number, send_date, featured_ids: featuredRaw.map(e => e.id) });
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
      featured_event_ids: featuredRaw.map(e => e.id),
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
