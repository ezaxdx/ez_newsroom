"use client";

import { useState, useEffect, useCallback } from "react";
import { NewsItem } from "@/lib/types";

type Slide = { category: string; item: NewsItem };

type Props = {
  slides: Slide[];
  onOpen: (item: NewsItem) => void;
  interval?: number; // ms, default 5000
};

export default function HeroCarousel({ slides, onOpen, interval = 5000 }: Props) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() =>
    setCurrent((c) => (c + 1) % slides.length), [slides.length]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setInterval(next, interval);
    return () => clearInterval(t);
  }, [paused, next, slides.length]);

  if (!slides.length) return null;

  const { item } = slides[current];
  const sideSlides = slides.filter((_, i) => i !== current);

  return (
    <section
      className="grid gap-3"
      style={{ gridTemplateColumns: "2fr 0.93fr" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* ── Main hero card ── */}
      <article
        className="relative min-h-[480px] rounded-lg overflow-hidden flex flex-col justify-end p-10 cursor-pointer"
        style={{
          background: `
            linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.34) 52%, rgba(0,0,0,0)),
            radial-gradient(circle at 50% 38%, rgba(124,124,124,0.7), rgba(28,27,29,0.94) 70%)
          `,
          color: "#ffffff",
        }}
        onClick={() => onOpen(item)}
      >
        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-30"
          />
        )}

        {/* Category + TOP NEWS pill */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex px-3 py-1 rounded-full text-xs font-bold tracking-[0.05em] uppercase"
            style={{ background: "#000", color: "#fff" }}
          >
            TOP NEWS
          </span>
          <span
            className="inline-flex px-3 py-1 rounded-full text-xs font-bold tracking-[0.05em] uppercase"
            style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
          >
            {item.category}
          </span>
        </div>

        <h2
          className="font-bold leading-[1.18] tracking-[-0.02em] mb-3 max-w-[28ch]"
          style={{ fontSize: "clamp(1.8rem, 2.5vw, 2.7rem)" }}
        >
          {item.title}
        </h2>

        <p className="mb-5 max-w-[66ch] text-sm leading-relaxed"
          style={{ color: "rgba(255,255,255,0.82)" }}>
          {item.summary_short}
        </p>

        <div className="flex items-center justify-between">
          <button
            className="h-10 px-4 rounded-md text-xs font-bold tracking-[0.04em] uppercase transition-opacity hover:opacity-80"
            style={{ background: "#fff", color: "#000", border: "none", cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
          >
            VIEW INSIGHT →
          </button>

          {/* Dot indicators */}
          <div className="flex gap-2">
            {slides.map((s, i) => (
              <button
                key={s.category}
                onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
                title={s.category}
                className="flex flex-col items-center gap-1 transition-all"
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px" }}
              >
                <span
                  className="text-[0.55rem] font-bold tracking-wider uppercase transition-opacity"
                  style={{ color: i === current ? "#fff" : "rgba(255,255,255,0.4)" }}
                >
                  {s.category}
                </span>
                <span
                  className="block rounded-full transition-all"
                  style={{
                    width: i === current ? "24px" : "8px",
                    height: "3px",
                    background: i === current ? "#fff" : "rgba(255,255,255,0.35)",
                  }}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        {!paused && slides.length > 1 && (
          <div
            className="absolute bottom-0 left-0 h-0.5"
            style={{ background: "rgba(255,255,255,0.3)", width: "100%" }}
          >
            <div
              key={current}
              className="h-full"
              style={{
                background: "#fff",
                animation: `progress ${interval}ms linear forwards`,
              }}
            />
          </div>
        )}

        <style>{`
          @keyframes progress { from { width: 0% } to { width: 100% } }
        `}</style>
      </article>

      {/* ── Side mini-cards (other categories) ── */}
      <aside
        className="flex flex-col gap-2 p-3 rounded-lg"
        style={{ background: "var(--surface-container-low)" }}
      >
        {sideSlides.map((slide) => (
          <article
            key={slide.category}
            className="flex flex-col p-4 rounded-md cursor-pointer transition-colors"
            style={{ background: "var(--surface-container-lowest)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-container-high)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-container-lowest)")}
            onClick={() => onOpen(slide.item)}
          >
            <span
              className="inline-flex self-start px-2.5 py-1 rounded-full text-[0.7rem] font-bold tracking-[0.05em] uppercase mb-2"
              style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)" }}
            >
              {slide.category}
            </span>
            <h3
              className="font-semibold leading-[1.35] mb-2"
              style={{ fontSize: "1.05rem", color: "var(--on-surface)", margin: "0 0 8px" }}
            >
              {slide.item.title}
            </h3>
            <p className="text-xs leading-relaxed line-clamp-2 m-0"
              style={{ color: "var(--on-surface-variant)" }}>
              {slide.item.summary_short}
            </p>
            <button
              className="self-start mt-2 text-[0.7rem] font-semibold tracking-[0.04em] uppercase hover:underline"
              style={{ color: "var(--on-surface-variant)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); onOpen(slide.item); }}
            >
              INSIGHT
            </button>
          </article>
        ))}
      </aside>
    </section>
  );
}
