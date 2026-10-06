import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateNewsletterHTML, EventCard } from "@/lib/newsletter-template";
import { sendNewsletterViaGmail } from "@/lib/gmail-sender";
import { fillEventDescriptions } from "@/lib/generate-event-descriptions";
import { loadScoringContext } from "@/lib/event-score-context";
import { liveRangeStart, selectNews, selectEvents } from "@/lib/newsletter-content";
import { verifyCronAuth } from "@/lib/verify-cron";
import { sendDiscordAlert } from "@/lib/discord-alert";

export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;   // 발송 시간 예산 — 초과하면 정상 응답으로 멈추고 남은 수신자는 관리자가 이어서 발송 (Vercel 강제 종료 방지)

/**
 * 뉴스레터 자동 발송 (크론). 콘텐츠 선정은 관리자 미리보기·수동 발송과 같은 로직(@/lib/newsletter-content)을 쓴다.
 *
 * 안전장치
 *  1. 오늘(KST) 이미 발송했거나 발송 중인 호가 있으면 건너뜀 (수동 발송 후 크론이 또 보내는 중복 방지)
 *  2. 발송 전에 이슈를 'sending' 으로 먼저 기록 — 도중에 끊겨도 어디까지 갔는지 남고, 재실행이 같은 호를 이어받음
 *  3. 수신자가 많아 시간 예산을 넘기면 'partial' 로 두고 디스코드로 알림 (관리자가 뉴스레터 관리에서 이어서 발송)
 *  4. 뉴스가 하나도 없으면 발송하지 않고 알림
 *  5. 정상 발송 완료도 디스코드로 알림
 */
export async function GET(req: NextRequest) {
  const unauth = verifyCronAuth(req);
  if (unauth) return unauth;

  const supabase = createAdminClient();

  const { data: settings } = await supabase.from("newsletter_cron_settings").select("*").single();
  if (!settings?.enabled) return NextResponse.json({ skipped: true, reason: "auto-send disabled" });

  // KST 기준 요일·시간 확인 (UTC+9)
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayDay = nowKST.getUTCDay();
  const nowHourKST = nowKST.getUTCHours();
  const sendHour = settings.send_hour ?? 10;
  const sendDays: number[] = Array.isArray(settings.send_days) && settings.send_days.length > 0 ? settings.send_days : [settings.send_day ?? 2];
  if (!sendDays.includes(todayDay)) return NextResponse.json({ skipped: true, reason: `오늘 요일 ${todayDay}, 설정 요일 [${sendDays.join(",")}]` });
  if (nowHourKST !== sendHour) return NextResponse.json({ skipped: true, reason: `현재 KST ${nowHourKST}시, 설정 시간 ${sendHour}시` });

  const today = new Date();
  const todayKSTStr = nowKST.toISOString().split("T")[0];
  const kstDayStart = new Date(`${todayKSTStr}T00:00:00+09:00`).toISOString();
  const kstDayEnd = new Date(`${todayKSTStr}T23:59:59+09:00`).toISOString();

  // ① 오늘 이미 발송했거나 발송 중이면 건너뜀
  const { data: todayIssues } = await supabase.from("newsletter_issues")
    .select("id, vol_number, status")
    .in("status", ["sent", "partial", "sending"])
    .gte("sent_at", kstDayStart).lte("sent_at", kstDayEnd).limit(1);
  if (todayIssues && todayIssues.length > 0) {
    return NextResponse.json({ skipped: true, reason: `오늘 이미 Vol.${todayIssues[0].vol_number} (${todayIssues[0].status}) 발송됨` });
  }

  // 수신자
  const { data: subscribers } = await supabase.from("newsletter_subscribers").select("id, email").eq("is_active", true);
  if (!subscribers || subscribers.length === 0) {
    await sendDiscordAlert({ title: "뉴스레터 자동발송 건너뜀", description: "활성 수신자가 없습니다.", level: "warning" });
    return NextResponse.json({ skipped: true, reason: "no active subscribers" });
  }

  // 콘텐츠 선정 — 미리보기·수동 발송과 같은 로직
  const [lastRunISO, scoring, { data: curation }] = await Promise.all([
    liveRangeStart(supabase),
    loadScoringContext(supabase),
    supabase.from("curation_settings").select("newsletter_footer_banner").limit(1).single(),
  ]);
  const news = await selectNews(supabase, lastRunISO);
  if (news.mice.length + news.tourism.length + news.ai.length + news.ezpmp.length === 0) {
    await sendDiscordAlert({
      title: "뉴스레터 자동발송 건너뜀 — 실을 뉴스가 없음",
      description: "라이브 범위와 최근 2주 안에 발행된 기사가 없습니다. 큐레이션 실행 상태를 확인하세요.",
      level: "error",
    });
    return NextResponse.json({ skipped: true, reason: "no news" });
  }

  const { featuredRaw, upcoming } = await selectEvents(supabase, { today, scoring });
  const descMap = await fillEventDescriptions(
    featuredRaw.map((e) => ({ id: e.id, event_name: e.event_name, description: e.description, website: e.website, industry: null, category: null, organizer: null })),
    supabase, process.env.GOOGLE_AI_API_KEY,
  );
  const featuredEvents: EventCard[] = featuredRaw.map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date, venue: e.venue,
    image_url: e.image_url, website: e.website, description: descMap[e.id] ?? null,
  }));

  // Vol 번호 — 수동 발송과 같은 기준 (발송·부분발송된 호 중 최대 + 1)
  const { data: maxVolData } = await supabase.from("newsletter_issues").select("vol_number")
    .in("status", ["sent", "partial"]).order("vol_number", { ascending: false }).limit(1);
  const vol_number = (maxVolData?.[0]?.vol_number ?? 0) + 1;
  const [ky, km, kd] = todayKSTStr.split("-");
  const send_date = `${ky}.${km}.${kd}`;
  const site_url = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app";

  const html = await generateNewsletterHTML({
    vol_number, send_date, editorial_text: settings.default_editorial ?? "",
    mice_news: news.mice, tourism_news: news.tourism, ai_news: news.ai, ezpmp_news: news.ezpmp,
    featured_events: featuredEvents, upcoming_events: upcoming,
    site_url, is_email: true, footer_banner: curation?.newsletter_footer_banner ?? null,
  });

  // ② 발송 전에 이슈를 먼저 기록
  const { data: issue, error: issueErr } = await supabase.from("newsletter_issues").insert({
    vol_number, editorial_text: settings.default_editorial ?? "", status: "sending", html_content: html,
    target_count: subscribers.length, total_sent: 0, total_failed: 0,
    sent_at: new Date().toISOString(), featured_event_ids: featuredRaw.map((e) => e.id),
  }).select("id").single();
  if (issueErr || !issue) {
    await sendDiscordAlert({ title: `뉴스레터 Vol.${vol_number} 자동발송 중단`, description: `이슈 기록 실패: ${issueErr?.message ?? "알 수 없음"}`, level: "error" });
    return NextResponse.json({ error: issueErr?.message ?? "이슈 생성 실패" }, { status: 500 });
  }

  const subject = `[EZ Letter] Vol.${vol_number} · ${send_date}`;
  const fromEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  let total_sent = 0, total_failed = 0;
  let processed = 0;

  try {
    const res = await sendNewsletterViaGmail({
      fromName: "EZ Letter", fromEmail, subject, html,
      recipients: subscribers.map((s) => ({ id: s.id as string, email: s.email as string })),
      siteUrl: site_url, issueId: issue.id, timeBudgetMs: TIME_BUDGET_MS,
      onBatchComplete: async (batch) => {
        total_sent += batch.filter((r) => r.status === "success").length;
        total_failed += batch.filter((r) => r.status === "failed").length;
        await Promise.all([
          supabase.from("newsletter_send_logs").insert(batch.map((r) => ({ ...r, issue_id: issue.id }))),
          supabase.from("newsletter_issues").update({ total_sent, total_failed }).eq("id", issue.id),
        ]);
      },
    });
    processed = res.processed;
  } catch (err) {
    await supabase.from("newsletter_issues").update({ status: total_sent > 0 ? "partial" : "failed", total_sent, total_failed }).eq("id", issue.id);
    await sendDiscordAlert({
      title: `뉴스레터 Vol.${vol_number} 자동발송 중 오류로 중단`,
      description: `${err instanceof Error ? err.message : String(err)}`.slice(0, 500) + `\n\n지금까지 ${total_sent}건 발송됨. 뉴스레터 관리에서 이어서 발송하세요.`,
      level: "error",
    });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  // ③ 마무리 — 시간 예산으로 남은 수신자가 있으면 partial
  const remaining = subscribers.length - processed;
  const finalStatus = total_sent === 0 ? "failed" : remaining === 0 ? "sent" : "partial";
  await supabase.from("newsletter_issues").update({ status: finalStatus, total_sent, total_failed }).eq("id", issue.id);

  const stat = [{ name: "추천 행사", value: featuredRaw.map((e) => e.event_name).join(" · ").slice(0, 300) || "-" }];
  if (finalStatus === "failed") {
    await sendDiscordAlert({ title: `뉴스레터 Vol.${vol_number} 자동발송 실패 (전체)`, description: `대상 ${subscribers.length}명 모두 실패했습니다. 발송 이력에서 사유를 확인하세요.`, level: "error", fields: stat });
  } else if (finalStatus === "partial") {
    await sendDiscordAlert({
      title: `뉴스레터 Vol.${vol_number} 일부만 발송됨`,
      description: `대상 ${subscribers.length}명 중 ${total_sent}건 발송, ${remaining}명 남음${total_failed ? `, 실패 ${total_failed}건` : ""}. 뉴스레터 관리에서 이어서 발송하세요.`,
      level: "warning", fields: stat,
    });
  } else {
    // ④ 정상 완료도 알림
    await sendDiscordAlert({
      title: `뉴스레터 Vol.${vol_number} 자동발송 완료`,
      description: `대상 ${subscribers.length}명 중 성공 ${total_sent}건${total_failed ? ` / 실패 ${total_failed}건` : ""}.`,
      level: total_failed ? "warning" : "info", fields: stat,
    });
  }

  return NextResponse.json({ ok: true, vol_number, status: finalStatus, total_sent, total_failed, remaining });
}
