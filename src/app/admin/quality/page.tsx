import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import QualityDashboard from "@/components/admin/QualityDashboard";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  event_name: string;
  venue: string;
  venue_region: string | null;
  category: string | null;
  organizer: string | null;
  start_date: string;
  end_date: string | null;
  website: string | null;
  is_published: boolean;
  is_ezpmp_pick: boolean;
  source: string | null;
  created_at: string;
  news_keywords?: string[] | null;
  news_count?: number;
  news_last?: string | null;
};

async function fetchNews(): Promise<NewsItem[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("news")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(2000);
    return (data ?? []) as NewsItem[];
  } catch { return []; }
}

async function fetchEvents(): Promise<EventRow[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("convention_events")
      .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, is_published, is_ezpmp_pick, source, created_at, news_keywords")
      .order("start_date", { ascending: true })
      .limit(2000);
    const events = (data ?? []) as EventRow[];

    // 이즈픽 행사별 관련 기사 수·최근 발행일 (큐레이션이 related_event_id 로 연결해 둔 기사)
    const pickIds = events.filter((e) => e.is_ezpmp_pick).map((e) => e.id);
    if (pickIds.length) {
      const { data: rel } = await supabase
        .from("news")
        .select("related_event_id, published_at")
        .in("related_event_id", pickIds)
        .eq("is_published", true);
      const agg = new Map<string, { n: number; last: string | null }>();
      for (const r of rel ?? []) {
        const a = agg.get(r.related_event_id) ?? { n: 0, last: null };
        a.n++;
        if (!a.last || (r.published_at && r.published_at > a.last)) a.last = r.published_at;
        agg.set(r.related_event_id, a);
      }
      for (const e of events) {
        if (!e.is_ezpmp_pick) continue;
        const a = agg.get(e.id);
        e.news_count = a?.n ?? 0;
        e.news_last = a?.last ?? null;
      }
    }
    return events;
  } catch { return []; }
}

export default async function QualityPage() {
  const [news, events] = await Promise.all([fetchNews(), fetchEvents()]);
  return <QualityDashboard news={news} events={events} />;
}
