import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import CurationBoard from "@/components/admin/CurationBoard";

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


const MOCK: NewsItem[] = [
  {
    id: "hero", title: "서울 MICE 산업, 생성형 AI 도입으로 운영 비용 23% 절감",
    summary_short: "국내 주요 컨벤션 운영사가 AI 기반 일정 최적화와 자동 응대 시스템을 도입했습니다.",
    content_long: "", implications: "", image_url: null, original_url: "#",
    category: "MICE", level: null, priority_score: 100, is_published: true, display_order: 1,
    published_at: "2026-04-23T09:00:00.000Z",
  },
  {
    id: "ai-1", title: "호텔 체인, 다국어 컨시어지 챗봇 전국 도입",
    summary_short: "외국인 투숙객 응대율이 60% 상승했습니다.",
    content_long: "", implications: "", image_url: null, original_url: "#",
    category: "AI", level: null, priority_score: 90, is_published: true, display_order: 2,
    published_at: "2026-04-23T09:00:00.000Z",
  },
  {
    id: "ai-2", title: "Global Trade Reach Numbers Hit as New Wave Goes Online",
    summary_short: "온라인 거래량 급증으로 글로벌 무역 지표가 최고치를 기록했습니다.",
    content_long: "", implications: "", image_url: null, original_url: "#",
    category: "AI", level: null, priority_score: 70, is_published: true, display_order: 3,
    published_at: "2026-04-23T09:00:00.000Z",
  },
  {
    id: "mice-1", title: "컨벤션 센터 3곳, 행사 운영 데이터 표준화 컨소시엄 출범",
    summary_short: "KPI 정의를 통일하고 레포트 포맷을 공통화합니다.",
    content_long: "", implications: "", image_url: null, original_url: "#",
    category: "MICE", level: null, priority_score: 60, is_published: true, display_order: 4,
    published_at: "2026-04-23T09:00:00.000Z",
  },
  {
    id: "tourism-1", title: "야간 관광 특화 콘텐츠로 체류시간 1.4배 증가",
    summary_short: "야간 프로그램을 도입한 지역에서 체류 시간이 크게 늘었습니다.",
    content_long: "", implications: "", image_url: null, original_url: "#",
    category: "TOURISM", level: null, priority_score: 80, is_published: false, display_order: 5,
    published_at: "2026-04-23T09:00:00.000Z",
  },
  {
    id: "startup-1", title: "여행 스타트업 데이터 연합으로 추천 전환율 상승",
    summary_short: "OTA 3사가 데이터를 공유한 뒤 추천 정확도가 38% 향상됐습니다.",
    content_long: "", implications: "", image_url: null, original_url: "#",
    category: "STARTUP", level: null, priority_score: 75, is_published: false, display_order: 6,
    published_at: "2026-04-23T09:00:00.000Z",
  },
];

async function fetchAllNews(): Promise<NewsItem[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return MOCK;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("news")
      .select("*")
      .order("display_order", { ascending: true });
    if (error || !data?.length) return MOCK;
    return data as NewsItem[];
  } catch { return MOCK; }
}

async function fetchSettings(): Promise<{
  qualityThresholds: { auto_publish: number; staging: number };
  displayWindowDays: number;
}> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
    return { qualityThresholds: { auto_publish: 8, staging: 5 }, displayWindowDays: 4 };
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("quality_thresholds, auto_schedule")
      .limit(1)
      .single();
    const qualityThresholds = data?.quality_thresholds ?? { auto_publish: 8, staging: 5 };
    const schedule = data?.auto_schedule ?? { enabled: false, days: [] };
    const displayWindowDays = schedule.enabled && schedule.days?.length > 1
      ? calcDisplayWindow(schedule.days)
      : 4;
    return { qualityThresholds, displayWindowDays };
  } catch { return { qualityThresholds: { auto_publish: 8, staging: 5 }, displayWindowDays: 4 }; }
}

export default async function AdminPage() {
  const [news, { qualityThresholds, displayWindowDays }] = await Promise.all([
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

      <CurationBoard initialNews={news} qualityThresholds={qualityThresholds} displayWindowDays={displayWindowDays} />
    </div>
  );
}
