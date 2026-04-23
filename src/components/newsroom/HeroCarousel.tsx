"use client";

import { useState, useEffect, useCallback } from "react";
import { NewsItem } from "@/lib/types";

type Slide = { category: string; item: NewsItem };

type Props = {
  slides: Slide[];
  onOpen: (item: NewsItem) => void;
  interval?: number;
};

function formatFeaturedDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (isToday) return "Featured Today";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function HeroCarousel({ slides, onOpen, interval = 5000 }: Props) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() =>
    setCurrent((c) => (c + 1) % slides.length), [slides.length]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setInterval(next, interval);
    return () => clearInterval(t);
  }, [paused, next, slides.length, interval]);

  if (!slides.length) return null;

  const { item } = slides[current];
  const sideSlides = slides.filter((_, i) => i !== current);

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* ── 상단 헤더 바: TOP NEWS (좌) + 점 인디케이터 (우) ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="block w-10 h-[2px]" style={{ background: "var(--on-surface)" }} />
          <span
            className="text-[0.72rem] font-bold tracking-[0.12em] uppercase"
            style={{ color: "var(--on-surface)" }}
          >
            Top News
          </span>
        </div>

        {/* 점 인디케이터 */}
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? "20px" : "8px",
                height: "8px",
                borderRadius: "99px",
                background: "var(--on-surface)",
                opacity: i === current ? 1 : 0.2,
                border: "none",
                cursor: "pointer",
                padding: 0,
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>
      </div>

      {/* ── 메인 그리드: 히어로(좌) + 사이드 패널(우) ── */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "2fr 0.93fr" }}
      >
        {/* ── 메인 히어로 카드 ── */}
        <article
          className="relative rounded-xl overflow-hidden cursor-pointer"
          style={{ minHeight: "460px" }}
          onClick={() => onOpen(item)}
        >
          {/* 배경 이미지 */}
          {item.image_url ? (
            <img
              src={item.image_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 50% 38%, rgba(80,90,100,0.9), rgba(18,18,20,0.98) 72%)",
              }}
            />
          )}

          {/* 그라디언트 오버레이 */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.08) 100%)",
            }}
          />

          {/* 콘텐츠 */}
          <div className="relative flex flex-col justify-end h-full p-9" style={{ minHeight: "460px" }}>
            {/* 카테고리 pill + Featured date */}
            <div className="flex items-center gap-3 mb-4">
              <span
                className="inline-flex px-3 py-1 rounded-full text-[0.7rem] font-bold tracking-[0.06em] uppercase"
                style={{ background: "#000", color: "#fff" }}
              >
                {item.category}
              </span>
              <span
                className="text-[0.78rem] font-medium"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                {formatFeaturedDate(item.published_at)}
              </span>
            </div>

            {/* 제목 */}
            <h2
              className="font-bold leading-[1.15] tracking-[-0.02em] mb-4 max-w-[22ch]"
              style={{
                fontSize: "clamp(1.7rem, 2.5vw, 2.6rem)",
                color: "#fff",
              }}
            >
              {item.title}
            </h2>

            {/* 요약 */}
            <p
              className="mb-7 max-w-[52ch] leading-relaxed line-clamp-2"
              style={{ fontSize: "0.92rem", color: "rgba(255,255,255,0.72)" }}
            >
              {item.summary_short}
            </p>

            {/* 버튼 */}
            <div>
              <button
                className="h-11 px-6 rounded-lg text-[0.78rem] font-bold tracking-[0.05em] uppercase transition-opacity hover:opacity-85"
                style={{ background: "#fff", color: "#000", border: "none", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); onOpen(item); }}
              >
                Read Article →
              </button>
            </div>
          </div>

          {/* 프로그레스 바 */}
          {!paused && slides.length > 1 && (
            <div
              className="absolute bottom-0 left-0 w-full h-[3px]"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <div
                key={current}
                className="h-full"
                style={{
                  background: "#fff",
                  animation: `heroProgress ${interval}ms linear forwards`,
                }}
              />
            </div>
          )}

          <style>{`
            @keyframes heroProgress { from { width: 0% } to { width: 100% } }
          `}</style>
        </article>

        {/* ── 사이드 미니 카드 패널 ── */}
        <aside
          className="flex flex-col gap-2 p-3 rounded-xl"
          style={{ background: "var(--surface-container-low)" }}
        >
          {sideSlides.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-xs"
              style={{ color: "var(--on-surface-variant)" }}>
              —
            </div>
          ) : (
            sideSlides.map((slide) => (
              <article
                key={slide.category}
                className="flex flex-col flex-1 p-4 rounded-lg cursor-pointer transition-colors"
                style={{ background: "var(--surface-container-lowest)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-container-high)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-container-lowest)")}
                onClick={() => onOpen(slide.item)}
              >
                <span
                  className="inline-flex self-start px-2.5 py-1 rounded-full text-[0.68rem] font-bold tracking-[0.05em] uppercase mb-2"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)" }}
                >
                  {slide.category}
                </span>
                <h3
                  className="font-semibold leading-[1.35] mb-2 line-clamp-3"
                  style={{ fontSize: "0.95rem", color: "var(--on-surface)", margin: "0 0 8px" }}
                >
                  {slide.item.title}
                </h3>
                <p className="text-xs leading-relaxed line-clamp-2 m-0"
                  style={{ color: "var(--on-surface-variant)" }}>
                  {slide.item.summary_short}
                </p>
                <button
                  className="self-start mt-auto pt-3 text-[0.7rem] font-semibold tracking-[0.04em] uppercase hover:underline"
                  style={{ color: "var(--on-surface-variant)", background: "transparent", border: "none", padding: "12px 0 0", cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onOpen(slide.item); }}
                >
                  Read →
                </button>
              </article>
            ))
          )}
        </aside>
      </div>
    </section>
  );
}
