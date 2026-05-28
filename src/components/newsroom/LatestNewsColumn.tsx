"use client";

import { NewsItem } from "@/lib/types";
import { LEVEL_STYLE_LIGHT, getCategoryBg } from "@/lib/news-ui";
import ArticleImg from "./ArticleImg";

type Props = {
  news: NewsItem[];
  onOpen: (item: NewsItem) => void;
};

export default function LatestNewsColumn({ news, onOpen }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--surface-container-high)",
        background: "var(--surface-container-lowest)",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "13px 18px 11px",
          fontSize: "0.62rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: "var(--on-surface-variant)",
          borderBottom: "1px solid var(--surface-container-high)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span>최신 뉴스</span>
        <span style={{ fontSize: "0.58rem" }}>{news.length}건</span>
      </div>

      {/* Cards */}
      {news.map((item, idx) => (
        <article
          key={item.id}
          onClick={() => onOpen(item)}
          style={{
            padding: "14px 16px",
            borderBottom:
              idx < news.length - 1
                ? "1px solid var(--surface-container-high)"
                : "none",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            gap: 7,
            flex: 1,
            background: "var(--surface-container-lowest)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--surface-container)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--surface-container-lowest)")
          }
        >
          {/* Thumbnail */}
          <div
            style={{
              width: "100%",
              aspectRatio: "16 / 7",
              borderRadius: 6,
              overflow: "hidden",
              background: getCategoryBg(item.category, item.image_url),
              flexShrink: 0,
              position: "relative",
            }}
          >
            <ArticleImg
              src={item.image_url}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              fallbackWidth="40%"
            />
          </div>

          {/* Badges */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 20,
                fontSize: "0.58rem",
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase" as const,
                background: "var(--surface-container-highest)",
                color: "var(--on-surface)",
              }}
            >
              {item.category}
            </span>
            {item.level && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 20,
                  fontSize: "0.58rem",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase" as const,
                  background:
                    LEVEL_STYLE_LIGHT[item.level]?.bg ?? "rgba(26,28,29,0.08)",
                  color:
                    LEVEL_STYLE_LIGHT[item.level]?.color ?? "var(--on-surface)",
                }}
              >
                {item.level}
              </span>
            )}
          </div>

          {/* Title */}
          <p
            style={{
              margin: 0,
              fontSize: "0.88rem",
              fontWeight: 700,
              lineHeight: 1.35,
              letterSpacing: "-0.01em",
              color: "var(--on-surface)",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            }}
          >
            {item.title}
          </p>

          {/* Summary */}
          <p
            style={{
              margin: 0,
              fontSize: "0.74rem",
              lineHeight: 1.55,
              color: "var(--on-surface-variant)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            }}
          >
            {item.summary_short}
          </p>
        </article>
      ))}
    </div>
  );
}
