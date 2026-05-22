import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import CurationBoard from "@/components/admin/CurationBoard";
import HelpPanel from "@/components/admin/HelpPanel";

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

      <HelpPanel title="큐레이션 보드 가이드">
        <p style={{ marginBottom: 12 }}>
          뉴스룸의 핵심 운영 화면입니다. 수집된 기사 전체를 확인하고 발행·반려를 직접 처리합니다.
        </p>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>주요 기능</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>전체·발행됨·대기 중 기사 수 통계 확인</li>
          <li>기사별 품질 점수(1~10), 카테고리, 레벨 확인</li>
          <li>대기 중 기사 수동 발행 또는 삭제</li>
          <li><strong style={{ color: "var(--on-surface)" }}>큐레이션 즉시 실행</strong> — 스케줄 외 수동 실행</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>품질 점수 기준</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>6점 이상 → 자동 발행</li>
          <li>4~5점 → 대기 (수동 검토 후 발행)</li>
          <li>3점 이하 → 자동 폐기</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>자동 실행 스케줄</p>
        <ul style={{ paddingLeft: 16 }}>
          <li>매주 화요일·목요일 오전 9시 자동 실행</li>
          <li>수동 실행은 [큐레이션 실행] 버튼 클릭</li>
        </ul>
      </HelpPanel>
    </div>
  );
}
