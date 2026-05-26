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
  created_at: string;
};

export type RssSource = {
  id: string;
  source_name: string;
  url: string;
  source_type: string | null;
  default_category: string | null;
  weight: number;
  is_active: boolean;
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
      .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, is_published, created_at")
      .order("start_date", { ascending: true })
      .limit(2000);
    return (data ?? []) as EventRow[];
  } catch { return []; }
}

async function fetchRssSources(): Promise<RssSource[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("rss_sources")
      .select("id, source_name, url, source_type, default_category, weight, is_active")
      .order("source_name");
    return (data ?? []) as RssSource[];
  } catch { return []; }
}

export default async function QualityPage() {
  const [news, events, sources] = await Promise.all([fetchNews(), fetchEvents(), fetchRssSources()]);
  return <QualityDashboard news={news} events={events} sources={sources} />;
}
