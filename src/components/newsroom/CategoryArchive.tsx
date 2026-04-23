"use client";

import { useState, useMemo } from "react";
import { Search, Calendar } from "lucide-react";
import { NewsItem } from "@/lib/types";
import { logEvent } from "@/lib/analytics";
import InsightModal from "./InsightModal";

type Props = {
  category: string;
  items: NewsItem[];
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

function groupByDate(items: NewsItem[]) {
  const map = new Map<string, NewsItem[]>();
  for (const item of items) {
    const day = item.published_at.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(item);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
  초급: { bg: "var(--surface-container-highest)", color: "var(--on-surface-variant)" },
  중급: { bg: "rgba(26,28,29,0.72)", color: "#fff" },
  고급: { bg: "var(--primary)", color: "#fff" },
};

export default function CategoryArchive({ category, items }: Props) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("전체");
  const [activeItem, setActiveItem] = useState<NewsItem | null>(null);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const day = item.published_at.slice(0, 10);
      if (search) {
        const q = search.toLowerCase();
        if (!item.title.toLowerCase().includes(q) && !item.summary_short?.toLowerCase().includes(q)) return false;
      }
      if (dateFrom && day < dateFrom) return false;
      if (dateTo   && day > dateTo)   return false;
      if (levelFilter !== "전체" && item.level !== levelFilter) return false;
      return true;
    });
  }, [items, search, dateFrom, dateTo, levelFilter]);

  const grouped = groupByDate(filtered);

  const handleOpen = (item: NewsItem) => {
    setActiveItem(item);
    logEvent({ event_type: "detail_view", news_id: item.id });
  };

  return (
    <>
      {/* ── Filter bar ── */}
      <div
        className="flex items-center gap-3 mb-8 p-4 rounded-lg flex-wrap"
        style={{ background: "var(--surface-container-low)" }}
      >
        {/* Search */}
        <label className="relative flex items-center flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 pointer-events-none"
            style={{ color: "var(--on-surface-variant)" }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목 또는 키워드 검색"
            className="w-full h-9 pl-9 pr-3 rounded-md text-sm outline-none"
            style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
          />
        </label>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <Calendar size={14} style={{ color: "var(--on-surface-variant)" }} />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 px-3 rounded-md text-sm outline-none"
            style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
          />
          <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>~</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 px-3 rounded-md text-sm outline-none"
            style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
          />
        </div>

        {/* 레벨 필터 */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "rgba(26,28,29,0.06)" }}>
          {["전체", "초급", "중급", "고급"].map((lv) => {
            const isActive = levelFilter === lv;
            return (
              <button
                key={lv}
                onClick={() => setLevelFilter(lv)}
                className="px-3 py-1 rounded-md text-[0.7rem] font-semibold tracking-wide transition-all"
                style={{
                  background: isActive ? "#ffffff" : "transparent",
                  color: isActive ? "var(--on-surface)" : "var(--on-surface-variant)",
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

        {/* Result count */}
        <span className="text-xs ml-auto" style={{ color: "var(--on-surface-variant)" }}>
          {filtered.length}건
        </span>

        {/* Reset */}
        {(search || dateFrom || dateTo || levelFilter !== "전체") && (
          <button
            onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setLevelFilter("전체"); }}
            className="h-9 px-3 rounded-md text-xs font-medium transition-colors hover:opacity-80"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}
          >
            초기화
          </button>
        )}
      </div>

      {/* ── Articles grouped by date ── */}
      {grouped.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-sm"
          style={{ color: "var(--on-surface-variant)" }}>
          조건에 맞는 기사가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          {grouped.map(([day, dayItems]) => (
            <section key={day}>
              {/* Date header */}
              <div className="flex items-center gap-3 mb-5">
                <span className="block w-12 h-1" style={{ background: "var(--primary)" }} />
                <p className="m-0 text-[0.75rem] font-semibold tracking-[0.05em] uppercase"
                  style={{ color: "var(--on-surface-variant)" }}>
                  {formatDate(dayItems[0].published_at)}
                </p>
                <span className="text-[0.68rem] px-2 py-0.5 rounded-full"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
                  {dayItems.length}건
                </span>
              </div>

              {/* Flexible grid: 1~4 columns based on article count */}
              <div
                className="grid gap-6"
                style={{ gridTemplateColumns: `repeat(${Math.min(dayItems.length, 4)}, 1fr)` }}
              >
                {dayItems.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col cursor-pointer group"
                    onClick={() => handleOpen(item)}
                  >
                    {/* Thumbnail + level badge */}
                    <div
                      className="relative w-full mb-3 rounded overflow-hidden"
                      style={{ aspectRatio: "16/9", background: "var(--surface-container-highest)" }}
                    >
                      {item.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                      )}
                      {item.level && (
                        <span
                          className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[0.6rem] font-bold tracking-[0.05em] uppercase"
                          style={{
                            background: LEVEL_STYLE[item.level]?.bg ?? "var(--surface-container-highest)",
                            color: LEVEL_STYLE[item.level]?.color ?? "var(--on-surface-variant)",
                            backdropFilter: "blur(6px)",
                          }}
                        >
                          {item.level}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3
                      className="font-bold leading-[1.3] tracking-[-0.01em] mb-2 group-hover:underline underline-offset-4"
                      style={{ fontSize: "1rem", color: "var(--on-surface)", margin: 0 }}
                    >
                      {item.title}
                    </h3>

                    {/* Summary */}
                    <p className="text-[0.83rem] leading-relaxed line-clamp-3 mt-1 mb-3"
                      style={{ color: "var(--on-surface-variant)", margin: 0 }}>
                      {item.summary_short}
                    </p>

                    <button
                      className="self-start text-[0.7rem] font-semibold tracking-[0.04em] uppercase hover:underline mt-auto"
                      style={{ color: "var(--on-surface-variant)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); handleOpen(item); }}
                    >
                      READ MORE →
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <InsightModal item={activeItem} onClose={() => setActiveItem(null)} />
    </>
  );
}
