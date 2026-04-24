"use client";

import { useState, useEffect } from "react";
import { NewsItem } from "@/lib/types";
import { logEvent } from "@/lib/analytics";
import HeroCarousel from "./HeroCarousel";
import FeedBlock from "./FeedBlock";
import InsightModal from "./InsightModal";

type CategoryGroup = { label: string; items: NewsItem[] };
type HeroSlide = { category: string; item: NewsItem };

type Props = {
  heroSlides: HeroSlide[];
  categoryGroups: CategoryGroup[];
  carouselInterval?: number;
};

const LEVELS = ["Total", "Beginner", "Intermediate", "Advanced"] as const;
type LevelFilter = typeof LEVELS[number];

// 모든 레벨 활성 상태를 동일한 스타일로 통일
const ACTIVE_STYLE = { bg: "#ffffff", color: "var(--on-surface)" };

export default function NewsroomClient({ heroSlides, categoryGroups, carouselInterval }: Props) {
  const [activeItem, setActiveItem] = useState<NewsItem | null>(null);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("Total");

  useEffect(() => {
    logEvent({ event_type: "view" });
  }, []);

  const handleOpen = (item: NewsItem) => {
    setActiveItem(item);
    logEvent({ event_type: "detail_view", news_id: item.id });
  };

  // 레벨 필터 적용 (히어로는 필터 제외)
  const filteredGroups = categoryGroups.map((group) => ({
    ...group,
    items: levelFilter === "Total"
      ? group.items
      : group.items.filter((item) => item.level === levelFilter),
  })).filter((group) => group.items.length > 0);


  return (
    <>
      <div className="flex flex-col gap-12">
        {/* 히어로 + 레벨 필터 */}
        <div>
          {/* 레벨 필터 — 히어로 우상단 */}
          <div className="flex justify-end mb-3" style={{ position: "relative", zIndex: 10 }}>
            <div
              className="flex gap-1 p-1 rounded-lg"
              style={{ background: "rgba(26,28,29,0.06)" }}
            >
              {LEVELS.map((lv) => {
                const isActive = levelFilter === lv;
                return (
                  <button
                    key={lv}
                    onClick={() => setLevelFilter(lv)}
                    className="px-3 py-1 rounded-md text-[0.7rem] font-semibold tracking-wide transition-all"
                    style={{
                      background: isActive ? ACTIVE_STYLE.bg : "transparent",
                      color: isActive ? ACTIVE_STYLE.color : "var(--on-surface-variant)",
                      border: "none",
                      cursor: "pointer",
                      boxShadow: isActive ? "0 1px 4px rgba(26,28,29,0.10)" : "none",
                    }}
                  >
                    {lv}
                  </button>
                );
              })}
            </div>
          </div>

          <HeroCarousel slides={heroSlides} onOpen={handleOpen} interval={carouselInterval} />
        </div>

        {filteredGroups.map((group) => (
          <FeedBlock key={group.label} label={group.label} items={group.items} onOpen={handleOpen} />
        ))}

        {filteredGroups.length === 0 && levelFilter !== "Total" && (
          <div className="flex items-center justify-center py-20 text-sm"
            style={{ color: "var(--on-surface-variant)" }}>
            {levelFilter} 기사가 없습니다.
          </div>
        )}
      </div>
      <InsightModal item={activeItem} onClose={() => setActiveItem(null)} />
    </>
  );
}
