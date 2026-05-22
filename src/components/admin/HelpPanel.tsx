"use client";

import { useState, useEffect } from "react";
import { X, BookOpen } from "lucide-react";

interface HelpPanelProps {
  title: string;
  children: React.ReactNode;
}

export default function HelpPanel({ title, children }: HelpPanelProps) {
  const [open, setOpen] = useState(false);

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {/* ── 플로팅 버튼 ── */}
      <button
        onClick={() => setOpen(true)}
        title="도움말 보기"
        style={{
          position: "fixed",
          bottom: 28,
          right: 28,
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "#1a1c1d",
          color: "#ffffff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 800,
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          zIndex: 500,
          transition: "transform 0.15s, box-shadow 0.15s",
          lineHeight: 1,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";
        }}
      >
        ?
      </button>

      {/* ── 딤 배경 ── */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.18)",
            zIndex: 600,
            backdropFilter: "blur(1px)",
          }}
        />
      )}

      {/* ── 슬라이드 드로어 ── */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          background: "var(--surface-container-lowest)",
          borderLeft: "1px solid var(--surface-container-high)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
          zIndex: 700,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.27s cubic-bezier(0.4,0,0.2,1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px",
            borderBottom: "1px solid var(--surface-container-high)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={15} style={{ color: "var(--on-surface-variant)" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--on-surface)" }}>
              {title}
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            style={{
              width: 28,
              height: 28,
              border: "none",
              background: "var(--surface-container-high)",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--on-surface-variant)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* 본문 */}
        <div
          style={{
            padding: "20px",
            overflowY: "auto",
            flex: 1,
            fontSize: 13,
            color: "var(--on-surface-variant)",
            lineHeight: 1.75,
          }}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
