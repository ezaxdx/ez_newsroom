"use client";

import { useState } from "react";
import { NewsItem } from "@/lib/types";
import { logEvent } from "@/lib/analytics";
import { getArticleImage, onImgError } from "@/lib/news-ui";
import InsightModal from "./InsightModal";

type Props = {
  items: NewsItem[];
  query: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
  Beginner:     { bg: "var(--surface-container-highest)", color: "var(--on-surface-variant)" },
  Intermediate: { bg: "rgba(26,28,29,0.72)",              color: "#fff" },
  Advanced:     { bg: "var(--primary)",                   color: "#fff" },
};

const CATEGORY_COLORS: Record<string, string> = {
  AI:       "var(--primary)",
  MICE:     "#7c3aed",
  TOURISM:  "#0891b2",
};

function highlight(text: string, query: string) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            style={{ background: "rgba(var(--primary-rgb,26,115,232),0.18)", color: "inherit", borderRadius: "2px", padding: "0 1px" }}
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export default function SearchResults({ items, query }: Props) {
  const [activeItem, setActiveItem] = useState<NewsItem | null>(null);

  const handleOpen = (item: NewsItem) => {
    setActiveItem(item);
    logEvent({ event_type: "detail_view", news_id: item.id });
  };

  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-32 gap-3"
        style={{ color: "var(--on-surface-variant)" }}
      >
        <p className="text-4xl m-0">🔍</p>
        <p className="text-base font-semibold m-0">
          {query ? `"${query}"에 대한 검색 결과가 없습니다` : "검색어를 입력해주세요"}
        </p>
        <p className="text-sm m-0">다른 키워드로 다시 검색해보세요</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col divide-y" style={{ borderTop: "1px solid var(--surface-container-highest)", borderBottom: "1px solid var(--surface-container-highest)" }}>
        {items.map((item) => (
          <article
            key={item.id}
            className="flex gap-5 py-5 cursor-pointer group hover:bg-[--surface-container-low] transition-colors px-2 rounded-lg"
            onClick={() => handleOpen(item)}
          >
            {/* Thumbnail */}
            <div
              className="flex-shrink-0 rounded overflow-hidden"
              style={{
                width: 120,
                height: 80,
                background: "var(--surface-container-highest)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getArticleImage(item.image_url)}
                alt=""
                className="w-full h-full"
                style={{
                  objectFit: item.image_url ? "cover" : "contain",
                  padding: item.image_url ? 0 : "30%",
                }}
                onError={onImgError}
                style={{
                  objectFit: item.image_url ? "cover" : "contain",
                  padding: item.image_url ? 0 : "30%",
                }}
              />
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col justify-between min-w-0">
              <div>
                {/* Badges */}
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span
                    className="px-2 py-0.5 rounded-full text-[0.6rem] font-bold tracking-[0.05em] uppercase"
                    style={{
                      background: CATEGORY_COLORS[item.category] ?? "var(--surface-container-highest)",
                      color: CATEGORY_COLORS[item.category] ? "#fff" : "var(--on-surface-variant)",
                    }}
                  >
                    {item.category}
                  </span>
                  {item.level && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[0.6rem] font-bold tracking-[0.05em] uppercase"
                      style={{
                        background: LEVEL_STYLE[item.level]?.bg ?? "var(--surface-container-highest)",
                        color: LEVEL_STYLE[item.level]?.color ?? "var(--on-surface-variant)",
                      }}
                    >
                      {item.level}
                    </span>
                  )}
                  <span className="text-[0.68rem]" style={{ color: "var(--on-surface-variant)" }}>
                    {formatDate(item.published_at)}
                  </span>
                </div>

                {/* Title */}
                <h3
                  className="font-bold leading-[1.35] tracking-[-0.01em] mb-1.5 group-hover:underline underline-offset-4"
                  style={{ fontSize: "0.95rem", color: "var(--on-surface)", margin: 0 }}
                >
                  {highlight(item.title, query)}
                </h3>

                {/* Summary */}
                <p
                  className="text-[0.82rem] leading-relaxed line-clamp-2"
                  style={{ color: "var(--on-surface-variant)", margin: 0 }}
                >
                  {highlight(item.summary_short ?? "", query)}
                </p>
              </div>

              <button
                className="self-start text-[0.68rem] font-semibold tracking-[0.04em] uppercase hover:underline mt-2"
                style={{ color: "var(--on-surface-variant)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); handleOpen(item); }}
              >
                READ MORE →
              </button>
            </div>
          </article>
        ))}
      </div>

      <InsightModal item={activeItem} onClose={() => setActiveItem(null)} />
    </>
  );
}
