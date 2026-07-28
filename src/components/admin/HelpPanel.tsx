"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { X, BookOpen } from "lucide-react";

// 페이지(서버 컴포넌트 포함)가 제목 옆 트리거와 본문 드로어를 서로 다른 위치에 렌더링해도
// 같은 열림/닫힘 상태를 공유할 수 있게 하는 헬퍼 — Provider로 감싸고 아래 두 컴포넌트를 원하는 위치에 배치
const HelpCtx = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <HelpCtx.Provider value={{ open, setOpen }}>{children}</HelpCtx.Provider>;
}

export function HelpTriggerConnected() {
  const ctx = useContext(HelpCtx);
  if (!ctx) return null;
  return <HelpTrigger onClick={() => ctx.setOpen(true)} />;
}

export function HelpPanelConnected({ title, children }: { title: string; children: React.ReactNode }) {
  const ctx = useContext(HelpCtx);
  if (!ctx) return null;
  return <HelpPanel title={title} open={ctx.open} onOpenChange={ctx.setOpen}>{children}</HelpPanel>;
}

/** 제목 옆에 작게 붙이는 도움말 트리거 — HelpPanel의 open 상태와 함께 페이지에서 직접 배치 */
export function HelpTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="도움말 보기"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "var(--surface-container-high)",
        color: "var(--on-surface-variant)",
        border: "1px solid var(--surface-container-highest)",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      ?
    </button>
  );
}

interface HelpPanelProps {
  title: string;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HelpPanel({ title, children, open, onOpenChange }: HelpPanelProps) {
  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  return (
    <>
      {/* ── 딤 배경 ── */}
      {open && (
        <div
          onClick={() => onOpenChange(false)}
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
            onClick={() => onOpenChange(false)}
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
