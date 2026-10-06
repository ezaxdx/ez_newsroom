// 뉴스레터 콘텐츠 선정 — 관리자 미리보기(content)·수동 발송(send)·자동 발송(cron)이 같은 로직을 쓰도록 한 곳에 모음.
// (세 곳에 복사돼 있던 코드가 서로 어긋나, 크론만 이즈픽 우선·동시개최 제외·중복 제거가 빠져 있었음)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsCard, EventCard } from "@/lib/newsletter-template";
import { scoreEvent, WEEKLY_LIST_MIN_SCORE, WEEKLY_EXCLUDE_KEYWORDS, type ScoringContext } from "@/lib/event-score";
import { calcLastScheduledRun } from "@/lib/schedule";

// ── 뉴스 ─────────────────────────────────────────────────────────────

type RawNews = { id: string; title: string; summary_short: string; image_url: string | null; original_url: string };
const toNewsCard = (n: RawNews): NewsCard => ({ id: n.id, title: n.title, summary: n.summary_short, image_url: n.image_url, url: n.original_url });

/** 큐레이션 라이브 범위(최근 실행 이후) — 안 씌우면 아카이브된 옛 기사가 display_order 낮은 값으로 계속 뽑힘 */
export async function liveRangeStart(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("curation_settings").select("auto_schedule").limit(1).single();
  const schedule = data?.auto_schedule ?? { enabled: false, days: [], hour: 9 };
  return schedule.enabled && schedule.days?.length > 0
    ? calcLastScheduledRun(schedule.days, schedule.hour ?? 9).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

export type NewsSections = { mice: NewsCard[]; tourism: NewsCard[]; ai: NewsCard[]; ezpmp: NewsCard[] };

/**
 * 카테고리별 상위 2건. 라이브 범위 안에서 display_order(큐레이션이 적합성·품질로 매긴 순위)가 좋은 순.
 * 같은 배치 기사는 발행 시각이 몇 분 차이라 최신순이 아니라 display_order 로 골라야 함.
 * 라이브가 0건일 때만 최근 2주 발행일 최신순으로 보충.
 */
export async function selectNews(supabase: SupabaseClient, lastRunISO: string): Promise<NewsSections> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  async function byCategory(orFilter: string): Promise<NewsCard[]> {
    const { data: liveRaw } = await supabase.from("news")
      .select("id, title, summary_short, image_url, original_url")
      .eq("is_published", true).gte("published_at", lastRunISO).or(orFilter)
      .order("display_order", { ascending: true }).limit(2);
    const live = (liveRaw ?? []) as RawNews[];
    if (live.length >= 1) return live.map(toNewsCard);   // 1건이어도 그대로 — 2주 전 기사로 억지로 채우지 않음
    const { data: fallbackRaw } = await supabase.from("news")
      .select("id, title, summary_short, image_url, original_url")
      .eq("is_published", true).gte("published_at", twoWeeksAgo).or(orFilter)
      .order("published_at", { ascending: false }).limit(2);
    return ((fallbackRaw ?? []) as RawNews[]).map(toNewsCard);
  }
  const [mice, tourism, ai, ezpmp] = await Promise.all([
    byCategory("category.ilike.%MICE%,category.ilike.%컨벤션%,category.ilike.%전시%"),
    byCategory("category.ilike.%TOURISM%,category.ilike.%관광%,category.ilike.%여행%"),
    byCategory("category.ilike.%AI%,category.ilike.%인공지능%,category.ilike.%테크%"),
    byCategory("category.ilike.%EZPMP%,category.ilike.%EZ PMP%,category.ilike.%ezpmp%"),
  ]);
  return { mice, tourism, ai, ezpmp };
}

// ── 행사 ─────────────────────────────────────────────────────────────

export type FeaturedEventRaw = {
  id: string; event_name: string; start_date: string; end_date: string | null;
  venue: string | null; website: string | null; image_url: string | null; description: string | null;
  industry?: string | null; category?: string | null; organizer?: string | null;
};

type PoolEvent = {
  id: string; event_name: string; event_name_en: string | null; start_date: string; end_date: string | null;
  venue: string | null; website: string | null; category: string | null; industry: string | null; organizer: string | null;
  image_url: string | null; description: string | null; is_ezpmp_pick: boolean | null; _score: number;
};

const NEAR_TERM_DAYS = 30;       // 추천 행사는 발송 시점 기준 30일 이내 행사만
const FEATURED_SLOTS = 4;

const normalizeVenue = (venue: string) => venue.replace(/\(.*?\)/g, "").replace(/[A-Za-z]/g, "").replace(/\s+/g, "").trim();
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

export async function selectEvents(supabase: SupabaseClient, opts: {
  today: Date; scoring: ScoringContext; existingFeaturedIds?: string[];
}): Promise<{ featuredRaw: FeaturedEventRaw[]; upcoming: EventCard[]; debug: Record<string, unknown> }> {
  const { today, scoring } = opts;
  const todayStr = today.toISOString().split("T")[0];
  const nowKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const dow = nowKST.getUTCDay();
  const endOfWeek = new Date(nowKST); endOfWeek.setUTCDate(endOfWeek.getUTCDate() + (dow === 0 ? 0 : 7 - dow));
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  // 같은 날(KST) 이미 발송된 호가 있으면 그 추천 행사를 그대로 재사용 → 같은 호는 항상 같은 Pick (그사이 비공개한 행사는 제외)
  const existing = opts.existingFeaturedIds ?? [];
  if (existing.length > 0) {
    const { data: reused } = await supabase.from("convention_events")
      .select("id, event_name, start_date, end_date, venue, website, image_url, description, industry, category, organizer")
      .in("id", existing).eq("is_published", true);
    const byId = new Map((reused ?? []).map((e) => [e.id as string, e as FeaturedEventRaw]));
    const featuredRaw = existing.map((id) => byId.get(id)).filter((e): e is FeaturedEventRaw => !!e)
      .map((e) => ({ ...e, event_name: e.event_name ?? "", start_date: e.start_date ?? todayStr }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    const upcoming = await weeklyList(supabase, { today, scoring, todayStr, endOfWeekStr, excludeIds: new Set(featuredRaw.map((e) => e.id)) });
    return { featuredRaw, upcoming, debug: { reused: true } };
  }

  // 후보 풀 — 공개 + 동시개최 제외(대표 행사만) + 30일 이내
  const { data: pool } = await supabase.from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url, description, is_ezpmp_pick")
    .eq("is_published", true).neq("is_concurrent", true)
    .gte("start_date", todayStr).lte("start_date", addDays(today, NEAR_TERM_DAYS))
    .order("start_date", { ascending: true }).limit(300);

  const scoredAll: PoolEvent[] = ((pool ?? []) as Omit<PoolEvent, "_score">[]).map((e) => ({
    ...e,
    _score: scoreEvent({
      event_name: e.event_name ?? "", event_name_en: e.event_name_en ?? null, category: e.category ?? null,
      industry: e.industry ?? null, organizer: e.organizer ?? null, venue: e.venue ?? "", start_date: e.start_date ?? todayStr,
    }, today, scoring),
  })).sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  // 같은 장소 + 같은 날 행사는 점수 1위만 (동시개최로 묶이지 않은 행사 중복 방지)
  const venueDate = new Map<string, PoolEvent>();
  for (const e of scoredAll) {
    const key = `${normalizeVenue(e.venue ?? "")}:${e.start_date ?? ""}`;
    if (!venueDate.has(key)) venueDate.set(key, e);
  }
  const scored = [...venueDate.values()].sort((a, b) => b._score - a._score || a.start_date.localeCompare(b.start_date));

  // 최근 2개 발송 호에 나온 Pick 제외
  const { data: recentIssues } = await supabase.from("newsletter_issues")
    .select("featured_event_ids").in("status", ["sent", "partial"]).order("sent_at", { ascending: false }).limit(2);
  const recentlyFeatured = new Set<string>((recentIssues ?? []).flatMap((i) => (i.featured_event_ids as string[] | null) ?? []));
  const d14 = addDays(today, 14), d30 = addDays(today, 30);

  // 어드민 ⭐ 이즈픽 최우선 (14일 → 30일 → 그 이후 근접도 순), 남는 자리는 점수 순으로 보충 (14일 → 30일 → 그 이후)
  const manualCandidates = scored.filter((e) => e.is_ezpmp_pick && !recentlyFeatured.has(e.id));
  const manualPicks = [
    ...manualCandidates.filter((e) => e.start_date <= d14),
    ...manualCandidates.filter((e) => e.start_date > d14 && e.start_date <= d30),
    ...manualCandidates.filter((e) => e.start_date > d30),
  ].slice(0, FEATURED_SLOTS);
  const pickedIds = new Set(manualPicks.map((e) => e.id));
  const autoSlots = Math.max(0, FEATURED_SLOTS - manualPicks.length);

  const candidatePool = scored.filter((e) => !pickedIds.has(e.id));
  const fresh = candidatePool.filter((e) => !recentlyFeatured.has(e.id));
  const seen = new Set<string>(pickedIds); const autoPicks: PoolEvent[] = [];
  for (const e of [
    ...fresh.filter((e) => e.start_date <= d14),
    ...fresh.filter((e) => e.start_date > d14 && e.start_date <= d30),
    ...fresh.filter((e) => e.start_date > d30),
    ...candidatePool,
  ]) {
    if (autoPicks.length >= autoSlots) break;
    if (!seen.has(e.id)) { seen.add(e.id); autoPicks.push(e); }
  }

  const featuredRaw: FeaturedEventRaw[] = [...manualPicks, ...autoPicks]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((e) => ({
      id: e.id, event_name: e.event_name ?? "", start_date: e.start_date ?? todayStr, end_date: e.end_date ?? null,
      venue: e.venue ?? null, website: e.website ?? null, image_url: e.image_url ?? null, description: e.description ?? null,
      industry: e.industry ?? null, category: e.category ?? null, organizer: e.organizer ?? null,
    }));

  const upcoming = weeklyFromScored(scored, new Set(featuredRaw.map((e) => e.id)), endOfWeekStr);
  return {
    featuredRaw, upcoming,
    debug: { manual: manualPicks.map((e) => e.event_name), auto: autoPicks.map((e) => `${e.event_name}(${e._score})`), pool: scored.length },
  };
}

function weeklyFromScored(scored: PoolEvent[], excludeIds: Set<string>, endOfWeekStr: string): EventCard[] {
  return scored.filter((e) => {
    if (excludeIds.has(e.id)) return false;
    if (e.start_date > endOfWeekStr) return false;
    if (e._score < WEEKLY_LIST_MIN_SCORE) return false;
    const nl = (e.event_name ?? "").toLowerCase();
    return !WEEKLY_EXCLUDE_KEYWORDS.some((kw) => nl.includes(kw.toLowerCase()));
  }).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 7).map((e) => ({
    name: e.event_name, start_date: e.start_date, end_date: e.end_date ?? null, venue: e.venue ?? null, website: e.website ?? null,
  }));
}

// 추천 행사를 재사용하는 경우에도 이번 주 행사 목록은 새로 계산
async function weeklyList(supabase: SupabaseClient, o: { today: Date; scoring: ScoringContext; todayStr: string; endOfWeekStr: string; excludeIds: Set<string> }): Promise<EventCard[]> {
  const { data: pool } = await supabase.from("convention_events")
    .select("id, event_name, event_name_en, start_date, end_date, venue, website, category, industry, organizer, image_url, description, is_ezpmp_pick")
    .eq("is_published", true).neq("is_concurrent", true)
    .gte("start_date", o.todayStr).lte("start_date", o.endOfWeekStr)
    .order("start_date", { ascending: true }).limit(300);
  const scored = ((pool ?? []) as Omit<PoolEvent, "_score">[]).map((e) => ({
    ...e,
    _score: scoreEvent({
      event_name: e.event_name ?? "", event_name_en: e.event_name_en ?? null, category: e.category ?? null,
      industry: e.industry ?? null, organizer: e.organizer ?? null, venue: e.venue ?? "", start_date: e.start_date ?? o.todayStr,
    }, o.today, o.scoring),
  })).sort((a, b) => b._score - a._score);
  return weeklyFromScored(scored, o.excludeIds, o.endOfWeekStr);
}
