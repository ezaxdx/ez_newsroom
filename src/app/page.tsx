import { createClient } from "@/lib/supabase/server";
import { NewsItem } from "@/lib/types";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import TopBar from "@/components/newsroom/TopBar";
import NewsroomClient from "@/components/newsroom/NewsroomClient";
import Footer from "@/components/newsroom/Footer";

const MOCK_NEWS: NewsItem[] = [
  // ── TOP / HERO ──
  {
    id: "hero",
    title: "서울 MICE 산업, 생성형 AI 도입으로 운영 비용 23% 절감",
    summary_short:
      "국내 주요 컨벤션 운영사가 AI 기반 일정 최적화와 자동 응대 시스템을 도입하며, 행사 운영 인력 부담과 응답 지연을 동시에 줄였습니다.",
    content_long:
      "서울 내 대형 컨벤션 센터 3곳이 생성형 AI를 도입한 이후 6개월 평균 운영 비용이 23% 감소했다는 조사 결과가 발표됐습니다.",
    implications:
      "운영 자동화는 비용 절감보다 데이터 축적 구조를 먼저 설계해야 합니다. FAQ 자동화부터 시작하되 참가자 의도 분류 기준을 먼저 정의하면 확장성이 높아집니다.",
    image_url: null,
    original_url: "#",
    category: "MICE",
    priority_score: 100,
    is_published: true,
    display_order: 1,
    published_at: new Date().toISOString(),
  },
  // ── SIDE (3개) ──
  {
    id: "side-1",
    title: "호텔 체인, 다국어 컨시어지 챗봇 전국 도입",
    summary_short: "외국인 투숙객 응대율이 60% 상승하며 직원 부담이 줄고 만족도가 높아졌습니다.",
    content_long: "국내 주요 호텔 체인이 영·일·중·스페인어를 지원하는 AI 컨시어지 챗봇을 전 지점에 배포했습니다.",
    implications: "다국어 챗봇 도입 시 빈번한 질의 유형 Top 20부터 학습시키는 것이 ROI 극대화 방법입니다.",
    image_url: null,
    original_url: "#",
    category: "AI",
    priority_score: 90,
    is_published: true,
    display_order: 2,
    published_at: new Date().toISOString(),
  },
  {
    id: "side-2",
    title: "야간 관광 특화 콘텐츠로 체류시간 1.4배 증가",
    summary_short: "체험 중심 야간 프로그램을 도입한 지역에서 평균 체류 시간이 크게 늘었습니다.",
    content_long: "지자체와 민간이 협력해 기획한 야간 미디어아트·역사투어 패키지가 효과적인 것으로 나타났습니다.",
    implications: "체류시간 증가는 이동 편의보다 콘텐츠 체인 연결이 좌우합니다.",
    image_url: null,
    original_url: "#",
    category: "TOURISM",
    priority_score: 80,
    is_published: true,
    display_order: 3,
    published_at: new Date().toISOString(),
  },
  {
    id: "side-3",
    title: "여행 스타트업 데이터 연합으로 추천 전환율 상승",
    summary_short: "소규모 OTA 3사가 데이터를 공유한 뒤 개인화 추천 정확도가 38% 향상됐습니다.",
    content_long: "여행 스타트업들이 연합 데이터 모델을 구성해 개인화 추천 품질을 높이는 실험이 성공적으로 마무리됐습니다.",
    implications: "추천 정확도보다 운영자가 해석 가능한 지표 설계가 핵심입니다.",
    image_url: null,
    original_url: "#",
    category: "STARTUP",
    priority_score: 75,
    is_published: true,
    display_order: 4,
    published_at: new Date().toISOString(),
  },
  // ── AI ──
  {
    id: "ai-1",
    title: "Global Trade Reach Numbers Hit as New Wave Goes Online",
    summary_short: "온라인 거래량 급증으로 글로벌 무역 지표가 전년 대비 최고치를 기록했습니다.",
    content_long: "디지털 무역 플랫폼의 확산으로 중소기업의 해외 진출 장벽이 낮아지고 있습니다.",
    implications: "디지털 전환은 규모의 경제보다 속도의 경제를 우선시합니다.",
    image_url: null, original_url: "#", category: "AI",
    priority_score: 70, is_published: true, display_order: 5, published_at: new Date().toISOString(),
  },
  {
    id: "ai-2",
    title: "Seed Rounds for B2B SaaS Startups Rise 28%: Valuation Hike",
    summary_short: "B2B SaaS 시드 라운드가 급증하며 AI 기반 업무 자동화 툴에 투자가 집중되고 있습니다.",
    content_long: "벤처캐피털의 관심이 소비자 앱에서 기업용 AI 솔루션으로 빠르게 이동하고 있습니다.",
    implications: "초기 투자 유치 시 ROI 증명 가능한 단일 유즈케이스에 집중하는 것이 유리합니다.",
    image_url: null, original_url: "#", category: "AI",
    priority_score: 68, is_published: true, display_order: 6, published_at: new Date().toISOString(),
  },
  {
    id: "ai-3",
    title: "The MICE Recovery: Q2 Travel Data Outpaces Pre-Pandemic Baselines",
    summary_short: "MICE 분야 2분기 여행 데이터가 팬데믹 이전 기준선을 앞질렀습니다.",
    content_long: "국제 행사 참석자 수가 2019년 수준을 회복하며 컨벤션 센터 예약률이 급등하고 있습니다.",
    implications: "수요 회복기에 차별화된 경험 설계가 중장기 경쟁력을 결정합니다.",
    image_url: null, original_url: "#", category: "AI",
    priority_score: 65, is_published: true, display_order: 7, published_at: new Date().toISOString(),
  },
  {
    id: "ai-4",
    title: "The M&E Recovery: Q2 Travel Data Outpaces Pre-Pandemic Baselines",
    summary_short: "미디어·엔터테인먼트 부문도 여행 회복세에 맞춰 성장 궤도에 진입했습니다.",
    content_long: "스트리밍과 라이브 이벤트의 경계가 허물어지며 복합 콘텐츠 경험 수요가 증가하고 있습니다.",
    implications: "온·오프라인 통합 전략이 관객 확장의 핵심 레버입니다.",
    image_url: null, original_url: "#", category: "AI",
    priority_score: 63, is_published: true, display_order: 8, published_at: new Date().toISOString(),
  },
  // ── MICE ──
  {
    id: "mice-1",
    title: "Run vs. Go: The Runtime Performance Trade-offs in 2024 Distributed Systems",
    summary_short: "분산 시스템에서 언어별 런타임 성능 차이가 아키텍처 선택에 미치는 영향을 분석했습니다.",
    content_long: "Go와 Rust의 런타임 특성을 비교 분석한 결과, 대규모 컨벤션 시스템에서 지연시간 차이가 운영 비용에 직접 영향을 줍니다.",
    implications: "운영 규모가 커질수록 런타임 선택이 TCO에 미치는 영향이 기하급수적으로 증가합니다.",
    image_url: null, original_url: "#", category: "MICE",
    priority_score: 60, is_published: true, display_order: 9, published_at: new Date().toISOString(),
  },
  {
    id: "mice-2",
    title: "Vector Databases and the Challenge of Real-Time Data: Semantic Hot-Level",
    summary_short: "실시간 시맨틱 검색을 위한 벡터 DB 도입이 MICE 플랫폼에서 가속화되고 있습니다.",
    content_long: "참가자 매칭, 세션 추천 등에 벡터 검색을 적용한 사례가 증가하며 플랫폼 만족도가 향상됐습니다.",
    implications: "벡터 DB는 단순 검색 개선을 넘어 개인화 경험의 인프라가 됩니다.",
    image_url: null, original_url: "#", category: "MICE",
    priority_score: 58, is_published: true, display_order: 10, published_at: new Date().toISOString(),
  },
  {
    id: "mice-3",
    title: "Vector Databases and the Challenge of Real-Time Data: Semantic Hot-level",
    summary_short: "컨벤션 현장 데이터를 실시간으로 처리하는 벡터 파이프라인 구축 사례가 주목받고 있습니다.",
    content_long: "부스 혼잡도 예측과 세션 추천을 결합한 통합 플랫폼이 운영 효율을 30% 향상시켰습니다.",
    implications: "데이터 파이프라인 설계는 현장 운영 품질의 선행 지표입니다.",
    image_url: null, original_url: "#", category: "MICE",
    priority_score: 56, is_published: true, display_order: 11, published_at: new Date().toISOString(),
  },
  // ── TOURISM ──
  {
    id: "tourism-1",
    title: "Vertical Integration as the Primary Competitive Moat in Tourism AI",
    summary_short: "수직 통합 전략이 관광 AI 시장에서 지속 가능한 경쟁 우위를 만들고 있습니다.",
    content_long: "데이터 수집부터 개인화 추천, 예약까지 하나의 플랫폼에서 처리하는 수직 통합 모델이 주목받고 있습니다.",
    implications: "수직 통합은 단기 개발 비용이 높지만 장기적으로 데이터 해자를 구축하는 최선의 방법입니다.",
    image_url: null, original_url: "#", category: "TOURISM",
    priority_score: 55, is_published: true, display_order: 12, published_at: new Date().toISOString(),
  },
  {
    id: "tourism-2",
    title: "Vertical Integration as the Primary Competitive Moat in AI",
    summary_short: "AI 분야에서도 수직 통합이 플랫폼 경쟁력의 핵심으로 자리 잡고 있습니다.",
    content_long: "모델 학습부터 서빙, 피드백 루프까지 통합 관리하는 기업이 벤치마크에서 앞서나가고 있습니다.",
    implications: "AI 스택 전체를 통제할 수 있는 기업이 장기 경쟁에서 유리한 위치를 점합니다.",
    image_url: null, original_url: "#", category: "TOURISM",
    priority_score: 53, is_published: true, display_order: 13, published_at: new Date().toISOString(),
  },
  {
    id: "tourism-3",
    title: "Vertical Integration as the Primary Competitive Moat in AI",
    summary_short: "관광 스타트업들이 수직 통합 전략으로 글로벌 OTA와의 경쟁에서 틈새를 공략하고 있습니다.",
    content_long: "특정 여행 카테고리에서 전체 여정을 소유하는 전략이 높은 리텐션과 마진으로 이어지고 있습니다.",
    implications: "틈새 시장에서의 수직 통합이 대형 플랫폼 대비 차별화된 경쟁력을 만듭니다.",
    image_url: null, original_url: "#", category: "TOURISM",
    priority_score: 51, is_published: true, display_order: 14, published_at: new Date().toISOString(),
  },
];

const CATEGORY_ORDER = ["AI", "MICE", "TOURISM", "STARTUP", "POLICY", "OPERATIONS", "INDUSTRY"];

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

type SiteSettings = { navCategories: string[]; carouselIntervalMs: number };

async function fetchSiteSettings(): Promise<SiteSettings> {
  const defaults = { navCategories: DEFAULT_NAV_CATEGORIES, carouselIntervalMs: 5000 };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return defaults;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("nav_categories, carousel_interval_sec")
      .limit(1)
      .single();
    return {
      navCategories: data?.nav_categories?.length ? data.nav_categories : defaults.navCategories,
      carouselIntervalMs: data?.carousel_interval_sec ? data.carousel_interval_sec * 1000 : defaults.carouselIntervalMs,
    };
  } catch { /* fallback */ }
  return defaults;
}

async function fetchNews(): Promise<NewsItem[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return MOCK_NEWS;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("news")
      .select("*")
      .eq("is_published", true)
      .order("display_order", { ascending: true });
    if (error || !data?.length) return MOCK_NEWS;
    return data as NewsItem[];
  } catch {
    return MOCK_NEWS;
  }
}

export default async function NewsroomPage() {
  const [news, { navCategories, carouselIntervalMs }] = await Promise.all([fetchNews(), fetchSiteSettings()]);

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
