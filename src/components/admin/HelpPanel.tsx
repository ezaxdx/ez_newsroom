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
            <BookOpen size={16} style={{ color: "var(--on-surface-variant)" }} />
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--on-surface)" }}>
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

// ── 매뉴얼 본문용 공통 서브컴포넌트 ──────────────────────────────
// 밀도 높은 "굵은 라벨 — 긴 설명문" 문단 대신, 큰 섹션 제목 아래 항목별로
// 굵은 소제목(한 줄) + 가는 본문(그 아래)을 분리해 가독성을 맞추는 용도.

/** 카드 하나 = 매뉴얼의 한 단계/섹션. 제목은 굵게 크게, 내용은 세로로 쌓임. n을 주면 "n. 제목"으로 번호가 붙음 */
export function Section({ title, n, children }: { title: string; n?: number; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface-container)", borderRadius: 10, padding: "18px 20px", marginBottom: 14 }}>
      <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "var(--on-surface)" }}>
        {n != null ? `${n}. ${title}` : title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

/** 번호 매겨진 진행 단계 (1, 2, 3...) */
export function Step({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ minWidth: 22, height: 22, borderRadius: "50%", background: "var(--primary)", color: "#fff",
        fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {n}
      </span>
      <span style={{ fontSize: 13, color: "var(--on-surface)", paddingTop: 2 }}>{text}</span>
    </div>
  );
}

/** 순서 상관없는 짧은 bullet 한 줄 */
export function Item({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ color: "var(--primary)", fontWeight: 700, flexShrink: 0, fontSize: 13 }}>·</span>
      <span style={{ fontSize: 13, color: "var(--on-surface)" }}>{text}</span>
    </div>
  );
}

/** Item 아래 한 단계 들여쓴 보충 설명 */
export function Indent({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginLeft: 16, fontSize: 13, color: "var(--on-surface-variant)" }}>{children}</div>
  );
}

/** 팁/주의 콜아웃 */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "color-mix(in srgb, var(--primary) 8%, transparent)",
      fontSize: 12, color: "var(--on-surface-variant)", borderLeft: "3px solid var(--primary)" }}>
      💡 {children}
    </div>
  );
}

/**
 * 용어 정의형 항목 — "굵은 라벨 — 긴 설명문" 한 문단으로 뭉치는 대신
 * 라벨은 굵게 한 줄, 설명은 그 아래 가는 글씨로 분리. 이전엔 <li><strong>라벨</strong> — 문장</li> 로 쓰던 곳 대체용.
 */
export function Def({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 700, color: "var(--on-surface)" }}>{term}</p>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "var(--on-surface-variant)", lineHeight: 1.65 }}>
        {children}
      </p>
    </div>
  );
}
