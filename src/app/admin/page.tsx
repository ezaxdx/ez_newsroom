import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import CurationBoard from "@/components/admin/CurationBoard";

export const dynamic = "force-dynamic";

/** 스케줄된 요일 배열로 최대 노출 기간(일) 계산 */
function calcDisplayWindow(days: number[]): number {
  if (!days || days.length <= 1) return 7;
  const sorted = [...days].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    maxGap = Math.max(maxGap, sorted[i + 1] - sorted[i]);
  }
  // wrap-around: 마지막 요일 → 다음 주 첫 요일
  maxGap = Math.max(maxGap, sorted[0] + 7 - sorted[sorted.length - 1]);
  return maxGap;
}


async function fetchAllNews(): Promise<NewsItem[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("news")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as NewsItem[];
  } catch { return []; }
}

async function fetchSettings(): Promise<{
  qualityThresholds: { auto_publish: number; staging: number };
  displayWindowDays: number;
  scheduleDays: number[];
  navCategories: string[];
}> {
  const defaults = { qualityThresholds: { auto_publish: 8, staging: 5 }, displayWindowDays: 4, scheduleDays: [2, 4], navCategories: [] };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return defaults;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("quality_thresholds, auto_schedule, nav_categories")
      .limit(1)
      .single();
    const qualityThresholds = data?.quality_thresholds ?? { auto_publish: 8, staging: 5 };
    const schedule = data?.auto_schedule ?? { enabled: false, days: [] };
    const scheduleDays: number[] = schedule.days ?? [];
    const displayWindowDays = schedule.enabled && scheduleDays.length > 1
      ? calcDisplayWindow(scheduleDays)
      : 4;
    const navCategories: string[] = data?.nav_categories ?? [];
    return { qualityThresholds, displayWindowDays, scheduleDays, navCategories };
  } catch { return defaults; }
}

export default async function AdminPage() {
  const [news, { qualityThresholds, displayWindowDays, scheduleDays, navCategories }] = await Promise.all([
    fetchAllNews(),
    fetchSettings(),
  ]);

  return (
    <div className="p-8 max-w-4xl">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "전체 기사", value: news.length },
          { label: "발행됨", value: news.filter((n) => n.is_published).length },
          { label: "대기 중", value: news.filter((n) => !n.is_published).length },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-5 rounded-lg"
            style={{ background: "var(--surface-container-lowest)" }}
          >
            <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-1"
              style={{ color: "var(--on-surface-variant)" }}>
              {label}
            </p>
            <p className="text-3xl font-bold tracking-tight m-0">{value}</p>
          </div>
        ))}
      </div>

      <CurationBoard initialNews={news} qualityThresholds={qualityThresholds} displayWindowDays={displayWindowDays} scheduleDays={scheduleDays} navCategories={navCategories} />
    </div>
  );
}
