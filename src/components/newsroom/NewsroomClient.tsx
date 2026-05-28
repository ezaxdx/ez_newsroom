"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { NewsItem } from "@/lib/types";
import { logEvent } from "@/lib/analytics";
import HeroCarousel from "./HeroCarousel";
import FeedBlock from "./FeedBlock";
import InsightModal from "./InsightModal";
import EventsColumn, { type CalendarEvent } from "./EventsColumn";
import EventTicker, { type TickerEvent } from "./EventTicker";

type CategoryGroup = { label: string; items: NewsItem[] };
type HeroSlide     = { category: string; item: NewsItem };

type Props = {
  heroSlides:     HeroSlide[];
  categoryGroups: CategoryGroup[];
  events:         CalendarEvent[];
  carouselInterval?: number;
};

const LEVELS = ["Total", "Beginner", "Intermediate", "Advanced"] as const;
type LevelFilter = typeof LEVELS[number];

export default function NewsroomClient({
  heroSlides,
  categoryGroups,
  events,
  carouselInterval,
}: Props) {
  const [activeItem, setActiveItem] = useState<NewsItem | null>(null);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("Total");

  useEffect(() => {
    logEvent({ event_type: "view" });
  }, []);

  const handleOpen = useCallback((item: NewsItem) => {
    setActiveItem(item);
    logEvent({ event_type: "detail_view", news_id: item.id });
  }, []);

  const filteredGroups = useMemo(
    () =>
      categoryGroups
        .map((group) => ({
          ...group,
          items:
            levelFilter === "Total"
              ? group.items
              : group.items.filter((item) => item.level === levelFilter),
        }))
        .filter((group) => group.items.length > 0),
    [categoryGroups, levelFilter]
  );

  const tickerEvents: TickerEvent[] = events;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column" }}>

        {/* ── 2단 메인 그리드 ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 260px",
            borderTop: "1px solid var(--surface-container-high)",
            borderBottom: "1px solid var(--surface-container-high)",
            height: "calc(100vh - 96px)",
          }}
        >
          {/* Col 1: 히어로 2×2 고정 그리드 */}
          <HeroCarousel
            slides={heroSlides}
            onOpen={handleOpen}
            interval={carouselInterval}
          />

          {/* Col 2: 행사 캘린더 */}
          <EventsColumn events={events} />
        </div>

        {/* ── 카테고리 피드 ── */}
        <div style={{ padding: "32px 32px 16px" }}>
          {/* 레벨 필터 */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: 4,
                borderRadius: 8,
                background: "rgba(26,28,29,0.06)",
              }}
            >
              {LEVELS.map((lv) => {
                const isActive = levelFilter === lv;
                return (
                  <button
                    key={lv}
                    onClick={() => setLevelFilter(lv)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                      background: isActive ? "#ffffff" : "transparent",
                      color: isActive ? "var(--on-surface)" : "var(--on-surface-variant)",
                      border: "none",
                      cursor: "pointer",
                      boxShadow: isActive ? "0 1px 4px rgba(26,28,29,0.10)" : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {lv}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 피드 블록 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 48, paddingBottom: 48 }}>
            {filteredGroups.map((group) => (
              <FeedBlock
                key={group.label}
                label={group.label}
                items={group.items}
                onOpen={handleOpen}
              />
            ))}

            {filteredGroups.length === 0 && levelFilter !== "Total" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "80px 0",
                  fontSize: "0.88rem",
                  color: "var(--on-surface-variant)",
                }}
              >
                {levelFilter} 기사가 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* ── 행사 일정 티커 ── */}
        <EventTicker events={tickerEvents} />
      </div>

      <InsightModal item={activeItem} onClose={() => setActiveItem(null)} />
    </>
  );
}
