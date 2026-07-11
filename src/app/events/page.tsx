import { createAdminClient } from "@/lib/supabase/admin";
import TopBar from "@/components/newsroom/TopBar";
import Footer from "@/components/newsroom/Footer";
import EventsClient, { ConventionEvent } from "@/components/events/EventsClient";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";

export const dynamic = "force-dynamic";

async function fetchNavCategories(): Promise<string[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("nav_categories")
      .limit(1)
      .single();
    return data?.nav_categories?.length ? data.nav_categories : DEFAULT_NAV_CATEGORIES;
  } catch {
    return DEFAULT_NAV_CATEGORIES;
  }
}

async function fetchEvents(): Promise<ConventionEvent[]> {
  try {
    const supabase = createAdminClient();
    const kstDateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("convention_events")
      .select("id, venue, venue_region, event_name, event_name_en, start_date, end_date, location, category, industry, organizer, website, is_ezpmp_pick")
      .eq("is_published", true)
      .or(`start_date.gte.${kstDateStr},end_date.gte.${kstDateStr}`)
      .order("start_date", { ascending: true });

    if (error) console.error("[fetchEvents]", error);
    return (data as ConventionEvent[]) ?? [];
  } catch (e) {
    console.error("[fetchEvents]", e);
    return [];
  }
}

export default async function EventsPage() {
  const [navCategories, events] = await Promise.all([
    fetchNavCategories(),
    fetchEvents(),
  ]);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
      <TopBar navCategories={navCategories} />
      <main className="flex-1">
        <EventsClient events={events} />
      </main>
      <Footer />
    </div>
  );
}
