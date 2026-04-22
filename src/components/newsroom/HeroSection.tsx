"use client";

import { NewsItem } from "@/lib/types";

type Props = {
  topNews: NewsItem;
  sideNews: NewsItem[];
  onOpen: (item: NewsItem) => void;
};

export default function HeroSection({ topNews, sideNews, onOpen }: Props) {
  return (
    <section className="grid gap-3" style={{ gridTemplateColumns: "2fr 0.93fr" }}>
      {/* ── Featured dark card ── */}
      <article
        className="relative min-h-[480px] rounded-lg overflow-hidden flex flex-col justify-end p-10 cursor-pointer"
        style={{
          background: `
            linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.34) 52%, rgba(0,0,0,0)),
            radial-gradient(circle at 50% 38%, rgba(124,124,124,0.7), rgba(28,27,29,0.94) 70%)
          `,
          color: "#ffffff",
        }}
        onClick={() => onOpen(topNews)}
      >
        {topNews.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={topNews.image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-30"
          />
        )}

        <span
          className="inline-flex self-start mb-3 px-3 py-1 rounded-full text-xs font-bold tracking-[0.05em] uppercase"
          style={{ background: "#000", color: "#fff" }}
        >
          TOP NEWS
        </span>

        <p
          className="text-xs font-semibold tracking-[0.05em] uppercase mb-1"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          {topNews.category}
        </p>

        <h2
          className="font-bold leading-[1.18] tracking-[-0.02em] mb-3 max-w-[28ch]"
          style={{ fontSize: "clamp(1.8rem, 2.5vw, 2.7rem)" }}
        >
          {topNews.title}
        </h2>

        <p className="mb-4 max-w-[66ch]" style={{ color: "rgba(255,255,255,0.82)" }}>
          {topNews.summary_short}
        </p>

        <button
          className="self-start h-10 px-4 rounded-md text-xs font-bold tracking-[0.04em] uppercase transition-opacity hover:opacity-80"
          style={{ background: "#fff", color: "#000" }}
          onClick={(e) => { e.stopPropagation(); onOpen(topNews); }}
        >
          VIEW INSIGHT →
        </button>
      </article>

      {/* ── Side mini-cards ── */}
      <aside
        className="flex flex-col gap-2 p-3 rounded-lg"
        style={{ background: "var(--surface-container-low)" }}
      >
        {sideNews.map((item) => (
          <article
            key={item.id}
            className="flex flex-col p-4 rounded-md cursor-pointer transition-colors"
            style={{ background: "var(--surface-container-lowest)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--surface-container-high)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--surface-container-lowest)")
            }
            onClick={() => onOpen(item)}
          >
            <span
              className="inline-flex self-start px-2.5 py-1 rounded-full text-[0.7rem] font-bold tracking-[0.05em] uppercase mb-2"
              style={{
                background: "var(--surface-container-highest)",
                color: "var(--on-surface)",
              }}
            >
              {item.category}
            </span>
            <h3
              className="font-semibold leading-[1.35] mb-1"
              style={{ fontSize: "1.05rem", color: "var(--on-surface)" }}
            >
              {item.title}
            </h3>
            <button
              className="self-start text-[0.72rem] font-semibold tracking-[0.04em] uppercase transition-all hover:underline"
              style={{ color: "var(--on-surface-variant)", background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            >
              INSIGHT
            </button>
          </article>
        ))}
      </aside>
    </section>
  );
}
