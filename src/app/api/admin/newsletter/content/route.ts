import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent, WEEKLY_LIST_MIN_SCORE, WEEKLY_EXCLUDE_KEYWORDS } from "@/lib/event-score";
import { fetchEventImage } from "@/lib/fetch-event-image";
import { fillEventDescriptions } from "@/lib/generate-event-descriptions";

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

  // Vol number = 실제 발송 완료(status=sent)된 건수 + 1 (테스트/드래프트는 미포함)
  const { count: issueCount } = await supabase
    .from("newsletter_issues")
    .select("*", { count: "exact", head: true })
    .eq("status", "sent");
  const vol_number = (issueCount ?? 0) + 1;

  type RawNews = { id: string; title: string; summary_short: string; image_url: string | null; original_url: string };
  const toCard = (n: RawNews): NewsCard => ({ title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url });

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
    return [...top, ...(latestRaw ?? []) as RawNews[]].map(toCard);
  }

  const miceNews    = await fetchCategoryNews("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%");
  const tourismNews = await fetchCategoryNews("category.ilike.%TOURISM%,category.ilike.%관광%,category.ilike.%여행%");
  const aiNews      = await fetchCategoryNews("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%");
  const ezpmpNews   = await fetchCategoryNews("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%");

  // ── 행사 스코어링 ──
  const nowKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = nowKST.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(nowKST);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSunday);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const { data: eventsPool } = await supabase
    .from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url, description, is_ezpmp_pick")
    .eq("is_published", true)
    .neq("is_concurrent", true)   // 동시개최 행사 제외 (메인 행사만)
    .gte("start_date", todayStr)
    .lte("start_date", new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("start_date", { ascending: true })
    .limit(200);

  const scoredAll = (eventsPool ?? [])
    .map((e) => ({ ...e, _score: scoreEvent({
      event_name: e.event_name ?? "",
      event_name_en: e.event_name_en ?? null,
      category: e.category ?? null,
      industry: e.industry ?? null,
      organizer: e.organizer ?? null,
      venue: e.venue ?? "",
      start_date: e.start_date ?? todayStr,
    }, today) }))
    .sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  // 동시개최 중복 제거: 같은 venue + start_date 조합은 점수 1위만 남김
  // 장소명 정규화: 영문·괄호·공백 제거 후 한글 핵심 이름만 추출
  function normalizeVenue(venue: string): string {
    return venue
      .replace(/\(.*?\)/g, "")   // 괄호 및 내용 제거: "킨텍스 (KINTEX)" → "킨텍스 "
      .replace(/[A-Za-z]/g, "")  // 영문 제거
      .replace(/\s+/g, "")       // 공백 제거
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

  // 실제 발송(send/route.ts)과 동일한 원칙: 어드민 ⭐ 픽 최우선 + 근거리(45일 이내)
  // 제한 + 남는 자리는 자동 점수로 보충. 이 엔드포인트는 발송 전 인트로 문구 작성을
  // 돕기 위한 미리보기용이라, 실제 발송 결과와 어긋나면 안 됨.
  const NEAR_TERM_DAYS = 45;
  const nearTermEnd = new Date(today.getTime() + NEAR_TERM_DAYS * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const scoredNearTerm = scored.filter(e => e.start_date <= nearTermEnd);

  const manualPicks = scoredNearTerm.filter(e => e.is_ezpmp_pick).slice(0, 4);
  const pickedIds = new Set(manualPicks.map(e => e.id));
  const autoSlots = Math.max(0, 4 - manualPicks.length);

  // Pick 선정: 14일 이내 우선 → 부족하면 30일 이내로 보충 → 그래도 부족하면 45일 전체로 보충
  // ※ 전체 교체가 아닌 보충 방식 — 가까운 날짜 행사가 항상 우선 포함됨
  const d14 = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const d30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const candidatePool = scoredNearTerm.filter(e => !pickedIds.has(e.id));
  const fresh = candidatePool.filter(e => !recentlyFeatured.has(e.id));
  const near = fresh.filter(e => e.start_date <= d14);
  const mid  = fresh.filter(e => e.start_date > d14 && e.start_date <= d30);
  const far  = fresh.filter(e => e.start_date > d30);
  const seenIds = new Set<string>(pickedIds);
  const pickPool: typeof fresh = [];
  for (const e of [...near, ...mid, ...far, ...candidatePool]) {
    if (pickPool.length >= autoSlots) break;
    if (!seenIds.has(e.id)) { seenIds.add(e.id); pickPool.push(e); }
  }
  const _debug = { d14, d30, near: near.length, mid: mid.length, far: far.length, manual_picks: manualPicks.map(e => e.event_name), near_top5: near.slice(0,5).map(e => `${e.event_name}(${e.start_date},${e._score})`), pick: pickPool.map(e => `${e.event_name}(${e.start_date})`) };
  const featuredRaw = [...manualPicks, ...pickPool.slice(0, autoSlots)].sort((a, b) => a.start_date.localeCompare(b.start_date));

  // description 없는 Pick 행사 → Gemini로 일괄 생성 + DB 캐시
  const descMap = await fillEventDescriptions(
    featuredRaw.map((e) => ({
      id: e.id,
      event_name: e.event_name,
      description: (e as { description?: string | null }).description ?? null,
      website: e.website ?? null,
      industry: e.industry ?? null,
      category: e.category ?? null,
      organizer: e.organizer ?? null,
    })),
    supabase,
    process.env.GOOGLE_AI_API_KEY
  );

  const featuredEvents: EventCard[] = await Promise.all(
    featuredRaw.map(async (e) => {
      const imageUrl = await fetchEventImage(e.event_name, e.website ?? null, e.image_url ?? null);
      return {
        name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null,
        venue: e.venue ?? null, image_url: imageUrl, website: e.website ?? null,
        description: descMap[e.id] ?? null,
      };
    })
  );

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
    ai_news: aiNews,
    ezpmp_news: ezpmpNews,
    featured_events: featuredEvents,
    upcoming_events: upcomingEvents,
    _debug,
  });
}
