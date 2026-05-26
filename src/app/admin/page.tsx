import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import CurationBoard from "@/components/admin/CurationBoard";
import HelpPanel from "@/components/admin/HelpPanel";

export const dynamic = "force-dynamic";


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
  scheduleHour: number;
  scheduleEnabled: boolean;
  navCategories: string[];
}> {
  const defaults = { qualityThresholds: { auto_publish: 8, staging: 5 }, displayWindowDays: 4, scheduleDays: [2, 4], scheduleHour: 9, scheduleEnabled: true, navCategories: [] };
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
    const scheduleHour: number = schedule.hour ?? 9;
    const scheduleEnabled: boolean = schedule.enabled ?? false;
    // displayWindowDays: CurationBoard의 스케줄 없을 때 폴백용
    // 실제 live/archive 분류는 CurationBoard에서 calcLastScheduledRun 사용
    const displayWindowDays = 4;
    const navCategories: string[] = data?.nav_categories ?? [];
    return { qualityThresholds, displayWindowDays, scheduleDays, scheduleHour, scheduleEnabled, navCategories };
  } catch { return defaults; }
}

export default async function AdminPage() {
  const [news, { qualityThresholds, displayWindowDays, scheduleDays, scheduleHour, scheduleEnabled, navCategories }] = await Promise.all([
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

      <CurationBoard initialNews={news} qualityThresholds={qualityThresholds} displayWindowDays={displayWindowDays} scheduleDays={scheduleDays} scheduleHour={scheduleHour} scheduleEnabled={scheduleEnabled} navCategories={navCategories} />

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
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>매주 화요일·목요일 오전 9시 자동 실행</li>
          <li>수동 실행은 [큐레이션 실행] 버튼 클릭</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>탭 분류 기준</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>메인 표시 중</strong> — 가장 최근 큐레이션 실행 이후 발행된 기사. 홈 페이지에 노출됨</li>
          <li><strong style={{ color: "var(--on-surface)" }}>대기열</strong> — 품질 점수 미달로 자동 발행 보류 중인 기사. 수동으로 발행·삭제 가능</li>
          <li><strong style={{ color: "var(--on-surface)" }}>아카이브</strong> — 이전 큐레이션 배치의 기사. 홈에서 내려간 상태이며 카테고리 아카이브 페이지에 표시됨</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>아카이브 기준</p>
        <ul style={{ paddingLeft: 16 }}>
          <li>기준 시각: 가장 최근 스케줄 실행일 오전 9시 KST (화·목 기준)</li>
          <li>기준 시각 <strong style={{ color: "var(--on-surface)" }}>이전</strong> 발행 → 아카이브 / <strong style={{ color: "var(--on-surface)" }}>이후</strong> 발행 → 메인 표시 중</li>
          <li>예) 목요일 큐레이션 실행 후 → 목요일 오전 9시 이전 기사는 전부 아카이브로 이동</li>
          <li>아카이브 기사는 [재발행] 버튼으로 오늘 날짜 기준 메인에 다시 올릴 수 있음</li>
        </ul>
      </HelpPanel>
    </div>
  );
}
