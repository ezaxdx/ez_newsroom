"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { logEvent } from "@/lib/analytics";

export type CalendarEvent = {
  id: string;
  event_name: string;
  venue: string;
  start_date: string;
  end_date: string | null;
  website?: string | null;
  is_pick?: boolean;
};

const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS_EN = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

type TooltipState = {
  dateStr: string;
  cellTop: number;
  cellBottom: number;
  cellCenterX: number;
} | null;

export default function EventsColumn({ events }: { events: CalendarEvent[] }) {
  // Init in useEffect to avoid SSR/client hydration mismatch
  const [viewYear, setViewYear]   = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState<number | null>(null); // 0-indexed
  const [todayStr, setTodayStr]   = useState<string | null>(null);
  const [tooltip, setTooltip]     = useState<TooltipState>(null);

  useEffect(() => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setTodayStr(
      `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
    );
  }, []);

  function prevMonth() {
    if (viewMonth === null || viewYear === null) return;
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }
  function nextMonth() {
    if (viewMonth === null || viewYear === null) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  // 날짜 → 해당 행사 목록 맵 (툴팁용)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const start = new Date(e.start_date);
      const end   = e.end_date ? new Date(e.end_date) : new Date(e.start_date);
      const cur   = new Date(start);
      let guard   = 0;
      while (cur <= end && guard < 60) {
        const key = `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        cur.setDate(cur.getDate() + 1);
        guard++;
      }
    }
    return map;
  }, [events]);

  // Dates that have at least one event (for dot markers)
  const eventDates = useMemo(() => new Set(eventsByDate.keys()), [eventsByDate]);

  // 픽 행사가 있는 날짜 (앰버 점 표시)
  const pickDates = useMemo(() => {
    const set = new Set<string>();
    for (const [date, evs] of eventsByDate) {
      if (evs.some((e) => e.is_pick)) set.add(date);
    }
    return set;
  }, [eventsByDate]);

  // Calendar grid cells
  const calCells = useMemo(() => {
    if (viewYear === null || viewMonth === null) return [];

    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth    = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev     = new Date(viewYear, viewMonth, 0).getDate();

    const prevYear  = viewMonth === 0 ? viewYear - 1 : viewYear;
    const prevMIdx  = viewMonth === 0 ? 11 : viewMonth - 1;
    const nextYear  = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nextMIdx  = viewMonth === 11 ? 0 : viewMonth + 1;

    const cells: { day: number; currentMonth: boolean; dateStr: string }[] = [];

    // Prev-month fill
    for (let i = 0; i < firstDayOfWeek; i++) {
      const d = daysInPrev - firstDayOfWeek + 1 + i;
      cells.push({
        day: d,
        currentMonth: false,
        dateStr: `${prevYear}-${pad2(prevMIdx + 1)}-${pad2(d)}`,
      });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        currentMonth: true,
        dateStr: `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`,
      });
    }
    // Next-month fill
    let nd = 1;
    while (cells.length % 7 !== 0) {
      cells.push({
        day: nd,
        currentMonth: false,
        dateStr: `${nextYear}-${pad2(nextMIdx + 1)}-${pad2(nd)}`,
      });
      nd++;
    }
    return cells;
  }, [viewYear, viewMonth]);

  // 보고 있는 월의 행사 — 픽 우선, 날짜순 (월 이동하면 리스트도 따라감)
  const upcoming = useMemo(() => {
    if (viewYear === null || viewMonth === null) return events.slice(0, 12);
    const monthStart = `${viewYear}-${pad2(viewMonth + 1)}-01`;
    const monthEnd   = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(new Date(viewYear, viewMonth + 1, 0).getDate())}`;
    return events
      .filter((e) => {
        const end = e.end_date ?? e.start_date;
        if (e.start_date > monthEnd || end < monthStart) return false; // 월과 겹치는 행사만
        if (todayStr && end < todayStr) return false;                  // 이미 종료된 행사 제외
        return true;
      })
      .sort((a, b) => {
        if (!!a.is_pick !== !!b.is_pick) return a.is_pick ? -1 : 1; // 픽 먼저
        return a.start_date.localeCompare(b.start_date);
      })
      .slice(0, 12);
  }, [events, viewYear, viewMonth, todayStr]);

  const handleEventClick = useCallback((e: CalendarEvent) => {
    logEvent({ event_type: "event_click", event_id: e.id });
    if (e.website) {
      window.open(e.website, "_blank", "noopener,noreferrer");
    }
  }, []);

  const monthLabel =
    viewYear !== null && viewMonth !== null
      ? `${viewYear}년 ${viewMonth + 1}월`
      : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--surface-container-high)",
        background: "var(--surface-container-lowest)",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* ── Header ── */}
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
        <span>EZPMP 픽</span>
        <span style={{ fontSize: "0.58rem" }}>{monthLabel}</span>
      </div>

      {/* ── Mini Calendar ── */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--surface-container-high)",
          flexShrink: 0,
        }}
      >
        {/* Month nav */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <button
            onClick={prevMonth}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--on-surface-variant)",
              fontSize: "0.9rem",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ‹
          </button>
          <span
            style={{
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "var(--on-surface)",
            }}
          >
            {monthLabel}
          </span>
          <button
            onClick={nextMonth}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--on-surface-variant)",
              fontSize: "0.9rem",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ›
          </button>
        </div>

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 2,
            textAlign: "center",
          }}
        >
          {/* Day labels */}
          {DAYS_KO.map((d) => (
            <div
              key={d}
              style={{
                fontSize: "0.58rem",
                fontWeight: 600,
                color: "var(--on-surface-variant)",
                padding: "3px 0",
              }}
            >
              {d}
            </div>
          ))}

          {/* Day cells */}
          {calCells.map((cell, i) => {
            const isToday    = cell.dateStr === todayStr;
            const hasEvent   = eventDates.has(cell.dateStr);
            return (
              <div
                key={i}
                style={{
                  fontSize: "0.68rem",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto",
                  position: "relative",
                  background: isToday ? "var(--on-surface)" : "transparent",
                  color: isToday
                    ? "var(--surface)"
                    : cell.currentMonth
                    ? "var(--on-surface)"
                    : "var(--surface-container-high)",
                  fontWeight: isToday ? 700 : 400,
                  cursor: hasEvent ? "pointer" : "default",
                }}
                onMouseEnter={hasEvent ? (ev) => {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  setTooltip({
                    dateStr:     cell.dateStr,
                    cellTop:     rect.top,
                    cellBottom:  rect.bottom,
                    cellCenterX: rect.left + rect.width / 2,
                  });
                } : undefined}
                onMouseLeave={hasEvent ? () => setTooltip(null) : undefined}
              >
                {cell.day}
                {hasEvent && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 3,
                      height: 3,
                      borderRadius: "50%",
                      background: isToday
                        ? "rgba(255,255,255,0.7)"
                        : pickDates.has(cell.dateStr) ? "#f59e0b" : "#7c6ef5",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Event List ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px 16px" }}>
        <p
          style={{
            fontSize: "0.58rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            color: "var(--on-surface-variant)",
            margin: "0 0 10px",
          }}
        >
          추천 행사
        </p>

        {upcoming.map((e, idx) => {
          const parts = e.start_date.split("-");
          const mIdx  = parseInt(parts[1]) - 1;
          const day   = parseInt(parts[2]);
          const endParts = e.end_date ? e.end_date.split("-") : null;
          const endSuffix =
            endParts && e.end_date !== e.start_date
              ? ` · ~${parseInt(endParts[1])}.${parseInt(endParts[2])}`
              : "";

          return (
            <div
              key={e.id}
              onClick={() => handleEventClick(e)}
              style={{
                display: "flex",
                gap: 10,
                padding: "9px 0",
                borderBottom:
                  idx < upcoming.length - 1
                    ? "1px solid var(--surface-container-high)"
                    : "none",
                cursor: e.website ? "pointer" : "default",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={(el) => { if (e.website) el.currentTarget.style.opacity = "0.65"; }}
              onMouseLeave={(el) => (el.currentTarget.style.opacity = "1")}
            >
              {/* Date box */}
              <div
                style={{
                  flexShrink: 0,
                  width: 34,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 2,
                }}
              >
                <span
                  style={{
                    fontSize: "0.5rem",
                    fontWeight: 700,
                    textTransform: "uppercase" as const,
                    color: "var(--on-surface)",
                    letterSpacing: "0.05em",
                  }}
                >
                  {MONTHS_EN[mIdx]}
                </span>
                <span
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 800,
                    color: "var(--on-surface)",
                    lineHeight: 1,
                  }}
                >
                  {day}
                </span>
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: "0 0 2px",
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    lineHeight: 1.3,
                    color: "var(--on-surface)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                    overflow: "hidden",
                  }}
                >
                  {e.is_pick && <span style={{ color: "#f59e0b", marginRight: 3 }}>★</span>}
                  {e.event_name}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.64rem",
                    color: "var(--on-surface-variant)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  📍 {e.venue}{endSuffix}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 날짜 호버 툴팁 (position:fixed로 overflow 탈출) ── */}
      {tooltip && (() => {
        const tooltipEvents = eventsByDate.get(tooltip.dateStr) ?? [];
        const [, m, d] = tooltip.dateStr.split("-").map(Number);

        const TIP_W   = 240;
        const TIP_EST = 40 + tooltipEvents.length * 52; // 대략적인 높이 추정
        const MARGIN  = 8;
        const vw = typeof window !== "undefined" ? window.innerWidth  : 1200;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;

        // 좌우 보정: 중앙 정렬 기준으로 뷰포트 벗어나지 않게 클램핑
        const rawLeft   = tooltip.cellCenterX - TIP_W / 2;
        const clampLeft = Math.max(MARGIN, Math.min(rawLeft, vw - TIP_W - MARGIN));

        // 위아래 보정: 아래 공간 부족하면 셀 위쪽으로 플립
        const showAbove = tooltip.cellBottom + TIP_EST + MARGIN > vh;
        const top       = showAbove
          ? tooltip.cellTop - TIP_EST - 6
          : tooltip.cellBottom + 6;

        return (
          <div
            style={{
              position: "fixed",
              top,
              left:    clampLeft,
              zIndex:  9999,
              background: "var(--surface-container-lowest)",
              border: "1px solid var(--surface-container-high)",
              borderRadius: 10,
              boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
              padding: "10px 14px",
              width:   TIP_W,
              pointerEvents: "none",
            }}
          >
            {/* 날짜 헤더 */}
            <p style={{
              margin: "0 0 8px",
              fontSize: "0.65rem",
              fontWeight: 700,
              color: "var(--on-surface-variant)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              {m}월 {d}일 · {tooltipEvents.length}건
            </p>
            {/* 행사 목록 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tooltipEvents.map((ev) => (
                <div key={ev.id}>
                  <p style={{
                    margin: 0,
                    fontSize: "0.76rem",
                    fontWeight: 600,
                    lineHeight: 1.35,
                    color: "var(--on-surface)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>
                    {ev.event_name}
                  </p>
                  <p style={{
                    margin: "2px 0 0",
                    fontSize: "0.64rem",
                    color: "var(--on-surface-variant)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    📍 {ev.venue}
                    {ev.end_date && ev.end_date !== ev.start_date
                      ? ` · ~${parseInt(ev.end_date.split("-")[1])}.${parseInt(ev.end_date.split("-")[2])}`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
