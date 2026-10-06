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
  seen_at?: Record<string, string> | null;
  is_concurrent?: boolean | null;
  parent_event_id?: string | null;
  hidden_reason?: string | null;
  news_count?: number;
  news_last?: string | null;
};

async function fetchNews(): Promise<NewsItem[]> {
  try {
    const supabase = createAdminClient();
    // 한 번에 1000행까지만 돌려주므로 이어서 전부 가져옴 (기사가 1000건을 넘으면 오래된 기사가 집계에서 빠지던 문제 방지)
    const out: NewsItem[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("news").select("*")
        .order("published_at", { ascending: false }).order("id", { ascending: true }).range(from, from + 999);
      out.push(...((data ?? []) as NewsItem[]));
      if ((data?.length ?? 0) < 1000) break;
    }
    return out;
  } catch { return []; }
}

async function fetchEvents(): Promise<EventRow[]> {
  try {
    const supabase = createAdminClient();
    const base = "id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, is_published, is_ezpmp_pick, source, created_at, news_keywords";
    // seen_at(출처 배지)·is_concurrent·parent_event_id(동시개최)·hidden_reason(비공개 사유)은 05~07 SQL 적용 후 존재 — 없으면 기본 컬럼만
    // Supabase 는 한 번에 최대 1000행만 돌려주므로(.limit(2000)을 줘도 1000행에서 잘림) 1000행씩 이어서 전부 가져옴
    // — 행사가 1000건을 넘으면서 가장 늦은 시작일의 행사부터 화면에서 빠지던 문제 방지
    const fetchAll = async (cols: string) => {
      const out: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("convention_events").select(cols)
          .order("start_date", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
        if (error) return { rows: null as unknown[] | null, error };
        out.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      return { rows: out as unknown[] | null, error: null };
    };
    let { rows } = await fetchAll(`${base}, seen_at, is_concurrent, parent_event_id, hidden_reason`);
    if (!rows) ({ rows } = await fetchAll(base));
    const events = (rows ?? []) as EventRow[];

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
