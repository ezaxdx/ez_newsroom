"use client";

export type TickerEvent = {
  id: string;
  event_name: string;
  venue: string;
  start_date: string;
  end_date: string | null;
};

function fmtRange(start: string, end: string | null) {
  const parts = start.split("-");
  const prefix = `${parseInt(parts[1])}.${parseInt(parts[2])}`;
  if (!end || end === start) return prefix;
  const ep = end.split("-");
  return `${prefix}~${parseInt(ep[1])}.${parseInt(ep[2])}`;
}

export default function EventTicker({ events }: { events: TickerEvent[] }) {
  if (!events.length) return null;
  const items = events.slice(0, 24);
  // Duplicate for seamless loop
  const doubled = [...items, ...items];

  return (
    <div
      style={{
        height: 36,
        background: "var(--surface-container-lowest)",
        borderTop: "1px solid var(--surface-container-high)",
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Label */}
      <div
        style={{
          flexShrink: 0,
          padding: "0 16px",
          fontSize: "0.6rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          color: "var(--on-surface)",
          borderRight: "1px solid var(--surface-container-high)",
          height: "100%",
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap" as const,
        }}
      >
        📅 행사 일정
      </div>

      {/* Scrolling track */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div
          style={{
            display: "flex",
            gap: 48,
            whiteSpace: "nowrap" as const,
            animation: "tickerScroll 70s linear infinite",
          }}
        >
          {doubled.map((e, i) => (
            <span
              key={i}
              style={{
                fontSize: "0.75rem",
                color: "var(--on-surface-variant)",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--on-surface)",
                  flexShrink: 0,
                  display: "inline-block",
                }}
              />
              {fmtRange(e.start_date, e.end_date)} &nbsp;{e.event_name} · {e.venue}
            </span>
          ))}
        </div>
        <style>{`
          @keyframes tickerScroll {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </div>
    </div>
  );
}
