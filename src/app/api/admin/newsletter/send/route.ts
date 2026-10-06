import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, EventCard } from "@/lib/newsletter-template";
import { loadScoringContext } from "@/lib/event-score-context";
import { selectNews, selectEvents } from "@/lib/newsletter-content";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";
import { fillEventDescriptions } from "@/lib/generate-event-descriptions";
import { calcLastScheduledRun } from "@/lib/schedule";
import { sendDiscordAlert } from "@/lib/discord-alert";

async function alertImageFallbacks(html: string, vol_number: number) {
  const matches = html.match(/<!--IMG_FALLBACK:([^>]*)-->/g);
  if (!matches || matches.length === 0) return;
  const names = matches.map(m => m.replace(/<!--IMG_FALLBACK:|-->/g, "")).slice(0, 10);
  await sendDiscordAlert({
    title: `뉴스레터 Vol.${vol_number} 이미지 ${matches.length}건 로딩 실패`,
    description: `원본 이미지에 접근할 수 없어 기본 로고로 대체됨: ${names.join(", ")}`,
    level: "warning",
  });
}

async function alertSendOutcome(params: { vol_number: number; total_sent: number; total_failed: number; target_count: number }) {
  if (params.total_failed === 0) return;
  const allFailed = params.total_sent === 0;
  await sendDiscordAlert({
    title: `뉴스레터 Vol.${params.vol_number} 발송 실패 ${allFailed ? "(전체)" : "일부"} 있음`,
    description: `대상 ${params.target_count}명 중 성공 ${params.total_sent}건 / 실패 ${params.total_failed}건. 발송 이력(뉴스레터 관리 → 이력)에서 실패 사유 확인 필요.`,
    level: allFailed ? "error" : "warning",
  });
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const BATCH_LIMIT = 25;           // 회차당 수신자 수 (60초 제한 대비 여유)
  const TIME_BUDGET_MS = 40_000;    // 발송 시간 예산 — 초과 시 정상 응답으로 중단 (Vercel 강제종료 방지)

  let body: {
    editorial_text?: string; dry_run?: boolean; skip_ezpmp?: boolean; reuse_prev_pick?: boolean;
    cached_html?: string; cached_vol?: number; cached_send_date?: string; cached_featured_ids?: string[];
    subject_override?: string; header_image_url?: string; editorial_flap_url?: string; editorial_box_color?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const editorial_text = body.editorial_text ?? "";
  const dry_run = body.dry_run === true;
  const skip_ezpmp = body.skip_ezpmp === true;
  const subject_override = body.subject_override?.trim() || null;
  const header_image_url = body.header_image_url || undefined;
  const editorial_flap_url = body.editorial_flap_url || undefined;
  const editorial_box_color = body.editorial_box_color || undefined;
  const supabase = createAdminClient();

  // ── 미리보기에서 생성된 HTML 캐시로 바로 발송 ──────────
  if (!dry_run && body.cached_html) {
    const { data: subscribers } = await supabase
      .from("newsletter_subscribers").select("id, email").eq("is_active", true);
    if (!subscribers || subscribers.length === 0)
      return NextResponse.json({ error: "활성 수신자가 없습니다." }, { status: 400 });

    const vol_number = body.cached_vol ?? 1;
    const send_date  = body.cached_send_date ?? new Date().toISOString().split("T")[0];
    const subject    = subject_override || `[EZ Letter] Vol.${vol_number} · ${send_date}`;

    // 미리보기 HTML 후처리: localhost → prod URL (프록시 유지 — 이메일 클라이언트 호환성)
    const prodUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";
    const sendHtml = body.cached_html
      .replace(/https?:\/\/localhost:\d+/g, prodUrl);

    const allRecipients = subscribers.map(s => s.email);
    const idByEmail = new Map(subscribers.map(s => [s.email, s.id as string]));

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
      await alertImageFallbacks(sendHtml, vol_number);
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
    const recipients = remaining.slice(0, BATCH_LIMIT).map(email => ({ email, id: idByEmail.get(email)! }));

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
        fromName: "EZ Letter", fromEmail, subject, html: sendHtml, recipients, siteUrl: prodUrl, issueId,
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
      await sendDiscordAlert({
        title: `뉴스레터 Vol.${vol_number} 발송 중 오류로 중단`,
        description: `${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
        level: "error",
      });
      return NextResponse.json({ error: `Gmail 발송 오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }

    const remainingAfter = remaining.length - processed; // 시간 예산으로 중단된 미처리분 포함
    const thisBatchSent = total_sent - prevSent;
    const finalStatus = total_sent === 0 ? "failed" : remainingAfter === 0 ? "sent" : "partial";
    await supabase.from("newsletter_issues")
      .update({ status: finalStatus, total_sent, total_failed })
      .eq("id", issueId);
    await alertSendOutcome({ vol_number, total_sent, total_failed, target_count: allRecipients.length });

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

  // 하단 상시 배너 — 발송마다 고르는 게 아니라 curation_settings에 저장된 값을 그대로 항상 반영
  const { data: bannerSettings } = await supabase
    .from("curation_settings").select("newsletter_footer_banner, auto_schedule").limit(1).single();
  const footer_banner = bannerSettings?.newsletter_footer_banner ?? null;
  const schedule = bannerSettings?.auto_schedule ?? { enabled: false, days: [], hour: 9 };
  const lastRunISO = schedule.enabled && schedule.days?.length > 0
    ? calcLastScheduledRun(schedule.days, schedule.hour ?? 9).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const today = new Date();

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

  // ── 뉴스·행사 선정 — 미리보기·수동 발송·자동 발송(크론)이 같은 로직을 쓰도록 @/lib/newsletter-content 로 통합 ──
  const news = await selectNews(supabase, lastRunISO);
  const { mice: miceNews, tourism: tourismNews, ai: aiNews, ezpmp: ezpmpNews } = news;

  const scoring = await loadScoringContext(supabase);
  // 같은 날(KST) 이미 발송된 호가 있으면 그 추천 행사를 재사용 → 같은 호는 항상 같은 Pick
  const existingFeaturedIds = (todayIssues?.[0]?.featured_event_ids as string[] | null) ?? [];
  const { featuredRaw, upcoming: upcomingEvents } = await selectEvents(supabase, { today, scoring, existingFeaturedIds });
  // description 없는 Pick 행사 → Gemini로 일괄 생성 + DB 캐시 (기존엔 미리보기/발송 경로에 빠져있던 부분)
  const descMap = await fillEventDescriptions(
    featuredRaw.map(e => ({
      id: e.id, event_name: e.event_name, description: e.description,
      website: e.website, industry: null, category: null, organizer: null,
    })),
    supabase,
    process.env.GOOGLE_AI_API_KEY
  );

  const featuredEvents: EventCard[] = featuredRaw.map(e => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date,
    venue: e.venue, image_url: e.image_url, website: e.website, description: descMap[e.id] ?? null,
  }));

  const html = await generateNewsletterHTML({
    vol_number, send_date, editorial_text,
    mice_news: miceNews, tourism_news: tourismNews, ai_news: aiNews, ezpmp_news: skip_ezpmp ? [] : ezpmpNews,
    featured_events: featuredEvents, upcoming_events: upcomingEvents,
    site_url, is_email: !dry_run, header_image_url, editorial_flap_url, editorial_box_color, footer_banner,
  });

  // ── 미리보기 반환 ──
  if (dry_run) {
    return NextResponse.json({ ok: true, html, vol_number, send_date, featured_ids: featuredRaw.map(e => e.id) });
  }

  // ── 실제 발송 ──
  const { data: subscribers } = await supabase
    .from("newsletter_subscribers").select("id, email").eq("is_active", true);
  if (!subscribers || subscribers.length === 0)
    return NextResponse.json({ error: "활성 수신자가 없습니다." }, { status: 400 });

  const subject      = subject_override || `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  const allRecipients2 = subscribers.map(s => s.email);
  const idByEmail2 = new Map(subscribers.map(s => [s.email, s.id as string]));

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
    await alertImageFallbacks(html, vol_number);
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
  const recipients2 = remaining2.slice(0, BATCH_LIMIT).map(email => ({ email, id: idByEmail2.get(email)! }));

  if (remaining2.length === 0) {
    await supabase.from("newsletter_issues").update({ status: "sent", total_sent: alreadySent2.size }).eq("id", issueId2);
    return NextResponse.json({ ok: true, vol_number, status: "sent", issue_id: issueId2, target_count: allRecipients2.length, total_sent: alreadySent2.size, total_failed: 0, remaining_count: 0 });
  }

  const fromEmail2 = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  let total_sent2 = alreadySent2.size, total_failed2 = 0;

  let processed2 = recipients2.length;
  try {
    const sendRes2 = await sendNewsletterViaGmail({
      fromName: "EZ Letter", fromEmail: fromEmail2, subject, html: htmlToSend2, recipients: recipients2, siteUrl: prod_url, issueId: issueId2,
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
    await sendDiscordAlert({
      title: `뉴스레터 Vol.${vol_number} 발송 중 오류로 중단`,
      description: `${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      level: "error",
    });
    return NextResponse.json({ error: `Gmail 발송 오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  const remainingAfter2 = remaining2.length - processed2; // 시간 예산으로 중단된 미처리분 포함
  const thisBatchSent2 = total_sent2 - alreadySent2.size;
  const finalStatus2 = total_sent2 === 0 ? "failed" : remainingAfter2 === 0 ? "sent" : "partial";
  await supabase.from("newsletter_issues")
    .update({ status: finalStatus2, total_sent: total_sent2, total_failed: total_failed2 })
    .eq("id", issueId2);
  await alertSendOutcome({ vol_number, total_sent: total_sent2, total_failed: total_failed2, target_count: allRecipients2.length });

  return NextResponse.json({ ok: true, vol_number, status: finalStatus2, issue_id: issueId2, target_count: allRecipients2.length, total_sent: total_sent2, this_batch_sent: thisBatchSent2, total_failed: total_failed2, remaining_count: remainingAfter2 });
}
