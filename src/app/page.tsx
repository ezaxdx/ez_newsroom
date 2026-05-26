import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import { calcLastScheduledRun } from "@/lib/schedule";
import TopBar from "@/components/newsroom/TopBar";
import NewsroomClient from "@/components/newsroom/NewsroomClient";
import Footer from "@/components/newsroom/Footer";

export const dynamic = "force-dynamic"; // 항상 최신 데이터 fetch

const CATEGORY_ORDER = ["MICE", "TOURISM", "AI", "STARTUP", "POLICY", "OPERATIONS", "INDUSTRY"];

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

async function fetchNews(lastRunISO: string): Promise<NewsItem[]> {
  try {
    const supabase = createAdminClient(); // service role → RLS 우회, 서버 전용

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

export default async function NewsroomPage() {
  const { navCategories, carouselIntervalMs, lastRunISO } = await fetchSiteSettings();
  const [news] = await Promise.all([fetchNews(lastRunISO)]);

  // One top article per nav category → hero carousel
  const heroSlides = navCategories
    .map((cat) => {
      const item = news.find((n) => n.category === cat);
      return item ? { category: cat, item } : null;
    })
    .filter(Boolean) as { category: string; item: NewsItem }[];

  const heroIds = new Set(heroSlides.map((s) => s.item.id));
  const navSet = new Set(navCategories);
  const feedNews = news.filter((n) => !heroIds.has(n.id) && navSet.has(n.category));
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
      <main className="flex-1 max-w-[1280px] mx-auto w-full px-8 py-8 pb-16">
        <NewsroomClient
          heroSlides={heroSlides}
          categoryGroups={categoryGroups}
          carouselInterval={carouselIntervalMs}
        />
      </main>
      <Footer />
    </div>
  );
}
