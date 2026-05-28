"use client";

import { NewsItem } from "@/lib/types";
import { LEVEL_STYLE_DARK, getArticleImage, onImgError, hasRealImage } from "@/lib/news-ui";

type Slide = { category: string; item: NewsItem };

type Props = {
  slides: Slide[];
  onOpen: (item: NewsItem) => void;
  interval?: number; // kept for prop compatibility, unused
};

export default function HeroCarousel({ slides, onOpen }: Props) {
  const items = slides.slice(0, 4);
  if (!items.length) return null;

  // 1개일 때: 1열, 2~3개: 2열 1행, 4개: 2×2
  const cols = items.length === 1 ? 1 : 2;
  const rows = items.length <= 2 ? 1 : 2;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        height: "100%",
        minHeight: rows === 1 ? 480 : 520,
      }}
    >
      {items.map((slide, i) => {
        const { item } = slide;
        const isLeftCol  = i % cols === 0;
        const isTopRow   = i < cols;
        const isLastCol  = i % cols === cols - 1;
        const isLastRow  = i >= items.length - cols;

        return (
          <article
            key={slide.category}
            onClick={() => onOpen(item)}
            style={{
              position: "relative",
              overflow: "hidden",
              cursor: "pointer",
              borderRight:  !isLastCol  ? "1px solid var(--surface-container-high)" : "none",
              borderBottom: !isLastRow  ? "1px solid var(--surface-container-high)" : "none",
              minHeight: rows === 1 ? 480 : 240,
            }}
          >
            {/* 배경 이미지 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getArticleImage(item.image_url)}
              alt=""
              style={hasRealImage(item.image_url) ? {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                background: "rgba(18,18,20,0.95)",
              } : {
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "38%",
                height: "auto",
                objectFit: "contain",
              }}
              onError={onImgError}
            />

            {/* 그라디언트 오버레이 */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.05) 100%)",
              }}
            />

            {/* 콘텐츠 */}
            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                height: "100%",
                padding: rows === 1 ? "28px 32px" : "20px 24px",
              }}
            >
              {/* 배지 */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    padding: "3px 10px",
                    borderRadius: 20,
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase" as const,
                    background: "#000",
                    color: "#fff",
                  }}
                >
                  {item.category}
                </span>
                {item.level && (
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase" as const,
                      background: LEVEL_STYLE_DARK[item.level]?.bg ?? "rgba(255,255,255,0.18)",
                      color: "#fff",
                      backdropFilter: "blur(4px)",
                      border: "1px solid rgba(255,255,255,0.25)",
                    }}
                  >
                    {item.level}
                  </span>
                )}
              </div>

              {/* 제목 */}
              <h2
                style={{
                  margin: "0 0 8px",
                  fontWeight: 800,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  color: "#fff",
                  fontSize: rows === 1
                    ? "clamp(1.5rem, 2.2vw, 2.2rem)"
                    : "clamp(0.95rem, 1.4vw, 1.25rem)",
                  display: "-webkit-box",
                  WebkitLineClamp: rows === 1 ? 3 : 3,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }}
              >
                {item.title}
              </h2>

              {/* 요약 (1행일 때만) */}
              {rows === 1 && item.summary_short && (
                <p
                  style={{
                    margin: "0 0 16px",
                    fontSize: "0.88rem",
                    lineHeight: 1.6,
                    color: "rgba(255,255,255,0.72)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                    overflow: "hidden",
                  }}
                >
                  {item.summary_short}
                </p>
              )}

              {/* CTA */}
              <button
                style={{
                  alignSelf: "flex-start",
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase" as const,
                  color: "rgba(255,255,255,0.6)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
                onClick={(e) => { e.stopPropagation(); onOpen(item); }}
              >
                Read Article →
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
