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
      .select("id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, is_published, is_ezpmp_pick, source, created_at")
      .order("start_date", { ascending: true })
      .limit(2000);
    return (data ?? []) as EventRow[];
  } catch { return []; }
}

export default async function QualityPage() {
  const [news, events] = await Promise.all([fetchNews(), fetchEvents()]);
  return <QualityDashboard news={news} events={events} />;
}
