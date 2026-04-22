import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewsItem } from "@/lib/types";
import { ALL_CATEGORIES, DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import TopBar from "@/components/newsroom/TopBar";
import Footer from "@/components/newsroom/Footer";
import CategoryArchive from "@/components/newsroom/CategoryArchive";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/* ── Mock archive data ── */
function makeMockItems(category: string): NewsItem[] {
  const today = new Date();
  const items: NewsItem[] = [];
  const titles: Record<string, string[]> = {
    AI: [
      "생성형 AI, 기업 업무 자동화에서 전략 보조로 역할 확장",
      "LLM 기반 고객 응대 시스템, 평균 해결률 71% 기록",
      "AI 에이전트 도입 기업 절반, 6개월 내 ROI 확인",
      "멀티모달 AI, 전시 콘텐츠 제작 비용 40% 절감",
    ],
    MICE: [
      "서울 MICE 산업, 생성형 AI 도입으로 운영 비용 23% 절감",
      "컨벤션 센터 3곳, 행사 데이터 표준화 컨소시엄 출범",
      "전시 운영사, AI 스케줄 자동 배정으로 대기 단축",
    ],
    TOURISM: [
      "야간 관광 특화 콘텐츠로 체류시간 1.4배 증가",
      "지자체, 행사장-숙박-교통 연동 패스 출시",
      "관광공사, 외국인 맞춤 안내 시나리오 40종 공개",
      "OTA, 지역 특화 패키지에 실시간 수요 예측 모델 결합",
      "공항 입국장 AI 안내 로봇, 외국인 만족도 88%",
    ],
  };

  const catTitles = titles[category.toUpperCase()] ?? [`${category} 관련 최신 뉴스`, `${category} 업계 동향 분석`];

  catTitles.forEach((title, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - Math.floor(i / 2));
    items.push({
      id: `${category}-archive-${i}`,
      title,
      summary_short: `${category} 분야의 최신 동향을 분석한 기사입니다. 업계 전문가들의 시각을 종합해 핵심 시사점을 도출했습니다.`,
      content_long: `${title}에 대한 상세 분석입니다. 국내외 주요 사례와 데이터를 바탕으로 전문가 시각을 정리했습니다.`,
      implications: `${category} 담당자라면 이 흐름을 주시해야 합니다. 단기적 비용 절감보다 데이터 축적 구조를 먼저 설계하는 것이 중장기 경쟁력의 핵심입니다.`,
      image_url: null,
      original_url: "#",
      category: category.toUpperCase(),
      priority_score: 100 - i * 10,
      is_published: true,
      display_order: i + 1,
      published_at: d.toISOString(),
    });
  });
  return items;
}

async function fetchCategoryItems(category: string): Promise<NewsItem[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return makeMockItems(category);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("news")
      .select("*")
      .eq("is_published", true)
      .ilike("category", category)
      .order("published_at", { ascending: false });
    if (error || !data?.length) return makeMockItems(category);
    return data as NewsItem[];
  } catch {
    return makeMockItems(category);
  }
}

async function fetchNavCategories(): Promise<string[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return DEFAULT_NAV_CATEGORIES;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("nav_categories")
      .limit(1)
      .single();
    if (data?.nav_categories?.length) return data.nav_categories;
  } catch { /* fallback */ }
  return DEFAULT_NAV_CATEGORIES;
}

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return ALL_CATEGORIES.map((cat) => ({ slug: cat.toLowerCase() }));
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = slug.toUpperCase();

  if (!ALL_CATEGORIES.includes(category as typeof ALL_CATEGORIES[number])) notFound();

  const [items, navCategories] = await Promise.all([
    fetchCategoryItems(category),
    fetchNavCategories(),
  ]);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
      <TopBar navCategories={navCategories} />

      <main className="flex-1 max-w-[1280px] mx-auto w-full px-8 py-8 pb-16">
        {/* Page header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-opacity hover:opacity-60"
            style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
          >
            <ArrowLeft size={12} /> 뉴스룸으로
          </Link>

          <div className="flex items-end gap-4">
            <div>
              <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-1"
                style={{ color: "var(--on-surface-variant)" }}>
                Category Archive
              </p>
              <h1
                className="font-bold tracking-[-0.02em] m-0"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
              >
                {category}
              </h1>
            </div>
            <span className="mb-2 text-sm" style={{ color: "var(--on-surface-variant)" }}>
              총 {items.length}건
            </span>
          </div>
        </div>

        <CategoryArchive category={category} items={items} />
      </main>

      <Footer />
    </div>
  );
}
