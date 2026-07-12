import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent, WEEKLY_LIST_MIN_SCORE, WEEKLY_EXCLUDE_KEYWORDS } from "@/lib/event-score";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const BATCH_LIMIT = 25;           // 회차당 수신자 수 (60초 제한 대비 여유)
  const TIME_BUDGET_MS = 40_000;    // 발송 시간 예산 — 초과 시 정상 응답으로 중단 (Vercel 강제종료 방지)

  let body: {
    editorial_text?: string; dry_run?: boolean; skip_ezpmp?: boolean; reuse_prev_pick?: boolean;
    cached_html?: string; cached_vol?: number; cached_send_date?: string; cached_featured_ids?: string[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const editorial_text = body.editorial_text ?? "";
  const dry_run = body.dry_run === true;
  const skip_ezpmp = body.skip_ezpmp === true;
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

    // 미리보기 HTML 후처리: localhost → prod URL (프록시 유지 — 이메일 클라이언트 호환성)
    const prodUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
    const sendHtml = body.cached_html
      .replace(/https?:\/\/localhost:\d+/g, prodUrl);

    const allRecipients = subscribers.map(s => s.email);

    // 같은 vol_number 이슈가 이미 있으면 재사용 (재발송 시 중복 방지)
    const { data: existingIssue } = await supabase
      .from("newsletter_issues")
      .select("id, total_sent")
      .eq("vol_number", vol_number)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let issueId: string;

    if (existingIssue) {
      issueId = existingIssue.id;
      await supabase.from("newsletter_issues").update({ status: "sending" }).eq("id", issueId);
    } else {
      const { data: newIssue, error: issueErr } = await supabase
        .from("newsletter_issues")
        .insert({
          vol_number, editorial_text, status: "sending",
          html_content: sendHtml,
          target_count: allRecipients.length,
          total_sent: 0, total_failed: 0,
          sent_at: new Date().toISOString(),
          featured_event_ids: body.cached_featured_ids ?? [],
        })
        .select("id").single();
      if (issueErr || !newIssue)
        return NextResponse.json({ error: issueErr?.message ?? "이슈 생성 실패" }, { status: 500 });
      issueId = newIssue.id;
    }

    // 이미 성공한 수신자 제외 → 재발송 이중 발송 방지
    const { data: sentLogs } = await supabase
      .from("newsletter_send_logs")
      .select("email")
      .eq("issue_id", issueId)
      .eq("status", "success");
    const alreadySent = new Set((sentLogs ?? []).map((l: { email: string }) => l.email));
    const remaining = allRecipients.filter(e => !alreadySent.has(e));
    const recipients = remaining.slice(0, BATCH_LIMIT);

    // newsletter_issues.total_sent 는 수동 수정될 수 있으므로 실제 로그 기준으로 초기화
    const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
    const prevSent = alreadySent.size;
    let total_sent = prevSent, total_failed = 0;

    if (remaining.length === 0) {
      await supabase.from("newsletter_issues").update({ status: "sent", total_sent }).eq("id", issueId);
      return NextResponse.json({ ok: true, vol_number, status: "sent", issue_id: issueId, target_count: allRecipients.length, total_sent, this_batch_sent: 0, total_failed: 0, remaining_count: 0 });
    }

    let processed = recipients.length;
    try {
      const sendRes = await sendNewsletterViaGmail({
        fromName: "EZ Letter", fromEmail, subject, html: sendHtml, recipients,
        timeBudgetMs: TIME_BUDGET_MS,
        onBatchComplete: async (batchResults) => {
          const batchSent = batchResults.filter(r => r.status === "success").length;
          const batchFailed = batchResults.filter(r => r.status === "failed").length;
          total_sent += batchSent;
          total_failed += batchFailed;
          await Promise.all([
            supabase.from("newsletter_send_logs")
              .insert(batchResults.map(r => ({ ...r, issue_id: issueId }))),
            supabase.from("newsletter_issues")
              .update({ total_sent, total_failed })
              .eq("id", issueId),
          ]);
        },
      });
      processed = sendRes.processed;
    } catch (err) {
      const partialSent = total_sent > prevSent;
      await supabase.from("newsletter_issues")
        .update({ status: partialSent ? "partial" : "failed", total_sent, total_failed })
        .eq("id", issueId);
      return NextResponse.json({ error: `Gmail 발송 오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }

    const remainingAfter = remaining.length - processed; // 시간 예산으로 중단된 미처리분 포함
    const thisBatchSent = total_sent - prevSent;
    const finalStatus = total_sent === 0 ? "failed" : remainingAfter === 0 ? "sent" : "partial";
    await supabase.from("newsletter_issues")
      .update({ status: finalStatus, total_sent, total_failed })
      .eq("id", issueId);

    return NextResponse.json({ ok: true, vol_number, status: finalStatus, issue_id: issueId, target_count: allRecipients.length, total_sent, this_batch_sent: thisBatchSent, total_failed, remaining_count: remainingAfter });
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
    .from("newsletter_issues").select("vol_number, featured_event_ids")
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
      .eq("is_published", true)
      .or(orFilter).neq("id", excludeId)
      .order("display_order", { ascending: true }).limit(1);
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

  // 같은 날(KST) 이미 발송된 호가 있으면 그 Pick 행사를 그대로 재사용 → 같은 호는 항상 같은 Pick
  const existingFeaturedIds = (todayIssues?.[0]?.featured_event_ids as string[] | null) ?? [];

  type FeaturedEventRaw = {
    id: string; event_name: string; start_date: string; end_date: string | null;
    venue: string | null; website: string | null; image_url: string | null; description: string | null;
  };
  let featuredRaw: FeaturedEventRaw[];

  if (existingFeaturedIds.length > 0) {
    // ── 기존 발송 Pick 재사용 ──
    const { data: reusedEvents } = await supabase.from("convention_events")
      .select("id, event_name, start_date, end_date, venue, website, image_url, description")
      .in("id", existingFeaturedIds);
    const byId = new Map((reusedEvents ?? []).map(e => [e.id, e]));
    featuredRaw = existingFeaturedIds
      .map(id => byId.get(id))
      .filter((e): e is NonNullable<ReturnType<typeof byId.get>> => e != null)
      .map(e => ({
        id: e.id,
        event_name: e.event_name ?? "",
        start_date: e.start_date ?? todayStr,
        end_date: e.end_date ?? null,
        venue: e.venue ?? null,
        website: e.website ?? null,
        image_url: (e as { image_url?: string | null }).image_url ?? null,
        description: (e as { description?: string | null }).description ?? null,
      }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  } else {
    // ── 스코어링 알고리즘으로 새 Pick 선정 ──
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
    featuredRaw = pickPool.slice(0, 4)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .map(e => ({
        id: e.id,
        event_name: e.event_name ?? "",
        start_date: e.start_date ?? todayStr,
        end_date: e.end_date ?? null,
        venue: e.venue ?? null,
        website: e.website ?? null,
        image_url: (e as { image_url?: string | null }).image_url ?? null,
        description: (e as { description?: string | null }).description ?? null,
      }));
  }

  const featuredEvents: EventCard[] = featuredRaw.map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date,
    venue: e.venue, image_url: e.image_url, website: e.website, description: e.description,
  }));

  const featuredIds = new Set(featuredRaw.map(e => e.id));
  const upcomingEvents: EventCard[] = scored.filter(e => {
    if (featuredIds.has(e.id)) return false;
    if (e.start_date > endOfWeekStr) return false;
    if (e._score < WEEKLY_LIST_MIN_SCORE) return false;
    const nl = (e.event_name ?? "").toLowerCase();
    if (WEEKLY_EXCLUDE_KEYWORDS.some(kw => nl.includes(kw.toLowerCase()))) return false;
    return true;
  }).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 7).map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
    venue: e.venue ?? null, website: e.website ?? null,
  }));

  const html = generateNewsletterHTML({
    vol_number, send_date, editorial_text,
    mice_news: miceNews, tourism_news: tourismNews, ai_news: aiNews, ezpmp_news: skip_ezpmp ? [] : ezpmpNews,
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

  const subject      = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  const allRecipients2 = subscribers.map(s => s.email);

  // 같은 vol_number 이슈 재사용 (캐시 경로와 동일한 중복방지 로직)
  const { data: existingIssue2 } = await supabase
    .from("newsletter_issues")
    .select("id, html_content")
    .eq("vol_number", vol_number)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 기존 이슈의 html_content 우선 사용 (새로고침 후 재발송 시 동일 내용 유지)
  const htmlToSend2 = existingIssue2?.html_content ?? html;

  let issueId2: string;
  if (existingIssue2) {
    issueId2 = existingIssue2.id;
    await supabase.from("newsletter_issues").update({ status: "sending" }).eq("id", issueId2);
  } else {
    const { data: newIssue2, error: issueErr2 } = await supabase
      .from("newsletter_issues")
      .insert({
        vol_number, editorial_text, status: "sending",
        html_content: html,
        target_count: allRecipients2.length,
        total_sent: 0, total_failed: 0,
        sent_at: new Date().toISOString(),
        featured_event_ids: featuredRaw.map(e => e.id),
      })
      .select("id").single();
    if (issueErr2 || !newIssue2)
      return NextResponse.json({ error: issueErr2?.message ?? "이슈 생성 실패" }, { status: 500 });
    issueId2 = newIssue2.id;
  }

  // 이미 성공한 수신자 제외
  const { data: sentLogs2 } = await supabase
    .from("newsletter_send_logs")
    .select("email")
    .eq("issue_id", issueId2)
    .eq("status", "success");
  const alreadySent2 = new Set((sentLogs2 ?? []).map((l: { email: string }) => l.email));
  const remaining2 = allRecipients2.filter(e => !alreadySent2.has(e));
  const recipients2 = remaining2.slice(0, BATCH_LIMIT);

  if (remaining2.length === 0) {
    await supabase.from("newsletter_issues").update({ status: "sent", total_sent: alreadySent2.size }).eq("id", issueId2);
    return NextResponse.json({ ok: true, vol_number, status: "sent", issue_id: issueId2, target_count: allRecipients2.length, total_sent: alreadySent2.size, total_failed: 0, remaining_count: 0 });
  }

  const fromEmail2 = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  let total_sent2 = alreadySent2.size, total_failed2 = 0;

  let processed2 = recipients2.length;
  try {
    const sendRes2 = await sendNewsletterViaGmail({
      fromName: "EZ Letter", fromEmail: fromEmail2, subject, html: htmlToSend2, recipients: recipients2,
      timeBudgetMs: TIME_BUDGET_MS,
      onBatchComplete: async (batchResults) => {
        const batchSent = batchResults.filter(r => r.status === "success").length;
        const batchFailed = batchResults.filter(r => r.status === "failed").length;
        total_sent2 += batchSent;
        total_failed2 += batchFailed;
        await Promise.all([
          supabase.from("newsletter_send_logs")
            .insert(batchResults.map(r => ({ ...r, issue_id: issueId2 }))),
          supabase.from("newsletter_issues")
            .update({ total_sent: total_sent2, total_failed: total_failed2 })
            .eq("id", issueId2),
        ]);
      },
    });
    processed2 = sendRes2.processed;
  } catch (err) {
    await supabase.from("newsletter_issues")
      .update({ status: total_sent2 > alreadySent2.size ? "partial" : "failed", total_sent: total_sent2, total_failed: total_failed2 })
      .eq("id", issueId2);
    return NextResponse.json({ error: `Gmail 발송 오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  const remainingAfter2 = remaining2.length - processed2; // 시간 예산으로 중단된 미처리분 포함
  const thisBatchSent2 = total_sent2 - alreadySent2.size;
  const finalStatus2 = total_sent2 === 0 ? "failed" : remainingAfter2 === 0 ? "sent" : "partial";
  await supabase.from("newsletter_issues")
    .update({ status: finalStatus2, total_sent: total_sent2, total_failed: total_failed2 })
    .eq("id", issueId2);

  return NextResponse.json({ ok: true, vol_number, status: finalStatus2, issue_id: issueId2, target_count: allRecipients2.length, total_sent: total_sent2, this_batch_sent: thisBatchSent2, total_failed: total_failed2, remaining_count: remainingAfter2 });
}
