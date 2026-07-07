import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import { calcLastScheduledRun } from "@/lib/schedule";
import { scoreEvent, EZPMP_PICK_MIN_SCORE } from "@/lib/event-score";
import TopBar from "@/components/newsroom/TopBar";
import NewsroomClient from "@/components/newsroom/NewsroomClient";
import Footer from "@/components/newsroom/Footer";
import type { CalendarEvent } from "@/components/newsroom/EventsColumn";

export const dynamic = "force-dynamic"; // 항상 최신 데이터 fetch

const CATEGORY_ORDER = ["MICE", "TOURISM", "AI", "EZPMP", "STARTUP", "POLICY", "OPERATIONS", "INDUSTRY"];

function groupByCategory(items: NewsItem[]) {
  const map = new Map<string, NewsItem[]>();
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  }
  return CATEGORY_ORDER
    .filter((cat) => map.has(cat))
    .map((cat) => ({ label: cat, items: map.get(cat)! }));
}

const FALLBACK_LAST_RUN_ISO = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

type SiteSettings = { navCategories: string[]; carouselIntervalMs: number; lastRunISO: string };

async function fetchSiteSettings(): Promise<SiteSettings> {
  const defaults = { navCategories: DEFAULT_NAV_CATEGORIES, carouselIntervalMs: 5000, lastRunISO: FALLBACK_LAST_RUN_ISO() };
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("nav_categories, carousel_interval_sec, auto_schedule")
      .limit(1)
      .single();
    const schedule = data?.auto_schedule ?? { enabled: false, days: [], hour: 9 };
    const scheduleDays: number[] = schedule.days ?? [];
    const scheduleHour: number = schedule.hour ?? 9;
    const lastRunISO = schedule.enabled && scheduleDays.length > 0
      ? calcLastScheduledRun(scheduleDays, scheduleHour).toISOString()
      : FALLBACK_LAST_RUN_ISO();
    return {
      navCategories: data?.nav_categories?.length ? data.nav_categories : defaults.navCategories,
      carouselIntervalMs: data?.carousel_interval_sec ? data.carousel_interval_sec * 1000 : defaults.carouselIntervalMs,
      lastRunISO,
    };
  } catch { /* fallback */ }
  return defaults;
}

// 히어로용: 카테고리별 최신 1건 + 부족하면 최신 기사로 보충해서 항상 4건
async function fetchHeroNews(categories: string[]): Promise<NewsItem[]> {
  try {
    const supabase = createAdminClient();

    // 카테고리별 display_order 가장 낮은 1건 (큐레이션보드 탑뉴스 기준과 동일)
    const perCat = await Promise.all(
      categories.map(async (cat) => {
        const { data } = await supabase
          .from("news")
          .select("*")
          .eq("is_published", true)
          .eq("category", cat)
          .order("display_order", { ascending: true })
          .limit(1);
        return (data?.[0] ?? null) as NewsItem | null;
      })
    );

    const results: NewsItem[] = perCat.filter(Boolean) as NewsItem[];

    // 4개 미만이면 최신 기사로 보충
    if (results.length < 4) {
      const existingIds = new Set(results.map((n) => n.id));
      const { data: recent } = await supabase
        .from("news")
        .select("*")
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(20);
      for (const item of (recent ?? []) as NewsItem[]) {
        if (!existingIds.has(item.id)) {
          results.push(item);
          existingIds.add(item.id);
          if (results.length >= 4) break;
        }
      }
    }

    return results.slice(0, 4);
  } catch (e) {
    console.error("[fetchHeroNews] Exception:", e);
    return [];
  }
}

// 피드용: 최근 큐레이션 이후 기사
async function fetchNews(lastRunISO: string): Promise<NewsItem[]> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("news")
      .select("*")
      .eq("is_published", true)
      .gte("published_at", lastRunISO)
      .order("display_order", { ascending: true });

    if (error) console.error("[fetchNews] Supabase error:", error);
    return (data as NewsItem[]) ?? [];
  } catch (e) {
    console.error("[fetchNews] Exception:", e);
    return [];
  }
}

async function fetchUpcomingEvents(): Promise<CalendarEvent[]> {
  try {
    const supabase = createAdminClient();
    // 오늘부터 향후 행사만 (종료일 기준 7일 여유)
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const { data } = await supabase
      .from("convention_events")
      .select("id, event_name, event_name_en, venue, start_date, end_date, organizer, category, industry, website")
      .eq("is_published", true)
      .gte("start_date", from)
      .order("start_date", { ascending: true })
      .limit(1000);

    if (!data?.length) return [];

    // EZPMP 픽 스코어링: 최소 점수 이상만, 스코어 내림차순 top 8
    const today = new Date();
    type RawEvent = CalendarEvent & {
      event_name_en?: string | null;
      organizer?: string | null;
      category?: string | null;
      industry?: string | null;
    };
    const scored = (data as RawEvent[])
      .map((e) => ({
        event: e,
        score: scoreEvent(
          {
            event_name:    e.event_name,
            event_name_en: e.event_name_en,
            venue:         e.venue,
            start_date:    e.start_date,
            organizer:     e.organizer,
            category:      e.category,
            industry:      e.industry,
          },
          today
        ),
      }))
      .filter(({ score }) => score >= EZPMP_PICK_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .sort((a, b) => a.event.start_date.localeCompare(b.event.start_date))
      .map(({ event }) => ({
        id:         event.id,
        event_name: event.event_name,
        venue:      event.venue,
        start_date: event.start_date,
        end_date:   event.end_date,
        website:    event.website ?? null,
      }));

    return scored;
  } catch {
    return [];
  }
}

export default async function NewsroomPage() {
  const { navCategories, carouselIntervalMs, lastRunISO } = await fetchSiteSettings();

  const heroCategories = [...navCategories, "BLOG"];
  const [heroNews, feedAllNews, events] = await Promise.all([
    fetchHeroNews(heroCategories),   // 히어로: 카테고리별 최신 1건 (시간 무관)
    fetchNews(lastRunISO),           // 피드: 최근 큐레이션 이후
    fetchUpcomingEvents(),
  ]);

  // 히어로 슬라이드 (카테고리 순서대로)
  const heroSlides = heroCategories
    .map((cat) => {
      const item = heroNews.find((n) => n.category === cat);
      return item ? { category: cat, item } : null;
    })
    .filter(Boolean) as { category: string; item: NewsItem }[];

  const heroIds = new Set(heroSlides.map((s) => s.item.id));
  const navSet  = new Set(heroCategories);

  // 카테고리 피드 (히어로와 겹치지 않는 기사)
  const feedNews       = feedAllNews.filter(
    (n) => !heroIds.has(n.id) && navSet.has(n.category)
  );
  const categoryGroups = groupByCategory(feedNews);

  if (!heroSlides.length) {
    return (
      <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
        <TopBar navCategories={navCategories} />
        <main className="flex-1 flex items-center justify-center">
          <p style={{ color: "var(--on-surface-variant)" }}>발행된 뉴스가 없습니다.</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
      <TopBar navCategories={navCategories} />
      <main className="flex-1">
        <NewsroomClient
          heroSlides={heroSlides}
          categoryGroups={categoryGroups}
          events={events}
          carouselInterval={carouselIntervalMs}
        />
      </main>
      <Footer />
    </div>
  );
}
