"use client";

/**
 * EZ Letter 로고 시스템 컴포넌트
 * variant 1~4 로 4가지 디자인 선택 가능
 *
 * 필요 폰트 (layout.tsx 또는 globals.css에 추가):
 * <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@900&family=DM+Sans:wght@500;700&display=swap" rel="stylesheet">
 */

const COLORS = {
  green:  "#50723C",
  dark:   "#423E28",
  mint:   "#63B995",
  pastel: "#E2EAD9",
  bg:     "#F4F1EA",
  white:  "#FFFFFF",
};

type Variant = 1 | 2 | 3 | 4;

type Props = {
  variant?: Variant;
  /** px 단위 너비 (높이는 자동) */
  size?: number;
  className?: string;
};

export default function EzLetterLogo({ variant = 1, size = 280, className }: Props) {
  const scale = size / 280;

  if (variant === 1) return <Logo1 scale={scale} className={className} />;
  if (variant === 2) return <Logo2 scale={scale} className={className} />;
  if (variant === 3) return <Logo3 scale={scale} className={className} />;
  return <Logo4 scale={scale} className={className} />;
}

// ── Variant 1: 불규칙 녹색 블롭, 스택 워드마크 ─────────────────────
function Logo1({ scale, className }: { scale: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <div style={{
        background: COLORS.green,
        width: 280, height: 260,
        borderRadius: "42% 58% 70% 30% / 45% 45% 55% 55%",
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
      }}>
        <div style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 900,
          fontSize: "3.2rem",
          color: COLORS.dark,
          lineHeight: 0.9,
          letterSpacing: "-0.03em",
          textTransform: "uppercase",
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          <span>EZ</span>
          <span style={{ marginTop: -10, transform: "rotate(-1deg)" }}>LETTER</span>
        </div>
      </div>
    </div>
  );
}

// ── Variant 2: 다크 브라운 블롭, 가로 워드마크 + 태그라인 ─────────────
function Logo2({ scale, className }: { scale: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <div style={{
        background: COLORS.dark,
        width: 320, height: 240,
        borderRadius: "50% 50% 30% 70% / 50% 60% 40% 50%",
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        padding: 20,
      }}>
        <div style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 900,
          fontSize: "2.5rem",
          color: COLORS.mint,
          lineHeight: 0.9,
          letterSpacing: "-0.03em",
          textTransform: "uppercase",
        }}>
          EZ LETTER
        </div>
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          fontSize: "0.9rem",
          letterSpacing: "0.05em",
          color: COLORS.mint,
          marginTop: 12,
        }}>
          Read the Room
        </p>
      </div>
    </div>
  );
}

// ── Variant 3: 민트 강낭콩 블롭, 이니셜 E + 태그라인 박스 ──────────────
function Logo3({ scale, className }: { scale: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <div style={{
        background: COLORS.mint,
        width: 260, height: 280,
        borderRadius: "60% 40% 40% 60% / 70% 30% 70% 30%",
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        position: "relative",
      }}>
        <span style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 900,
          fontSize: "6.5rem",
          color: COLORS.green,
          lineHeight: 1,
          marginBottom: 10,
        }}>
          E
        </span>
        <div style={{
          background: COLORS.green,
          color: COLORS.white,
          fontFamily: "'DM Sans', sans-serif",
          fontSize: "0.75rem",
          fontWeight: 700,
          padding: "6px 14px",
          borderRadius: 4,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          Read the Room
        </div>
      </div>
    </div>
  );
}

// ── Variant 4: 파스텔 블롭, 스택 워드마크 + 태그라인 ─────────────────
function Logo4({ scale, className }: { scale: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <div style={{
        background: COLORS.pastel,
        width: 290, height: 250,
        borderRadius: "40% 60% 50% 50% / 50% 50% 50% 50%",
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
      }}>
        <div style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 900,
          fontSize: "2.8rem",
          color: COLORS.green,
          lineHeight: 0.9,
          letterSpacing: "-0.03em",
          textTransform: "uppercase",
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          <span>EZ</span>
          <span>LETTER</span>
        </div>
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          fontSize: "0.9rem",
          letterSpacing: "0.05em",
          color: COLORS.green,
          marginTop: 12,
        }}>
          Read the Room
        </p>
      </div>
    </div>
  );
}
