"use client";

import { useState, useEffect, useRef } from "react";

export type PopupData = {
  id: string;
  title: string;
  image_url: string | null;
  link_url: string | null;
  content: string | null;
  display_type: string;  // modal | floating
  position: string;      // 3×3 위치 또는 random (floating 전용)
  pages: string[];       // 노출 페이지 목록
  random_page: boolean;  // true면 pages 중 한 곳에만 랜덤 노출
  hunt_code?: string | null; // 값이 있으면 찾기 이벤트 대상 — 클릭 시 링크 대신 코드를 알려주고 사라짐
  size_px?: number | null;   // 없으면 표시 방식별 기본값(고정 150 / 팝업 420)
  pos_x?: number | null;     // position="custom"일 때만 사용 — 관리자가 미리보기를 클릭해 찍은 위치(%)
  pos_y?: number | null;
  effect?: string | null;   // 이미지 위 장식 효과: none|sparkle|hearts|bounce|shake (없으면 none)
  content_overrides?: { from: string; to: string; text: string }[] | null; // 특정 날짜 구간(KST)에만 content 대신 보여줄 문구 (하루짜리는 from===to)
};

// 오늘(KST)이 속한 문구 오버라이드 구간이 있으면 그걸, 없으면 기본 content를 사용
function resolveEffectiveContent(popup: PopupData): string | null {
  const todayKstStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const override = popup.content_overrides?.find((o) => o.from <= todayKstStr && todayKstStr <= o.to);
  return override?.text ?? popup.content;
}

const DEFAULT_SIZE = { floating: 150, modal: 420 } as const;

// 말풍선 툴팁이 화면(뷰포트) 밖으로 나가지 않도록 — 중앙 정렬 기준에서 벗어난 만큼만 보정
function useEdgeClampedCenter(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!active) { setShift(0); return; }
    const el = ref.current;
    if (!el) return;
    const margin = 10;
    const r = el.getBoundingClientRect();
    let s = 0;
    if (r.right > window.innerWidth - margin) s -= r.right - (window.innerWidth - margin);
    if (r.left + s < margin) s += margin - (r.left + s);
    setShift(s);
  }, [active]);

  return { ref, style: { left: "50%", transform: `translateX(calc(-50% + ${shift}px))` } as React.CSSProperties };
}

// 이미지 위 장식 효과 — 관리자가 팝업 등록 시 고를 수 있음
export const EFFECT_LABELS: Record<string, string> = {
  none: "없음", sparkle: "반짝반짝 ✨", hearts: "하트 뿅뿅 💗", bounce: "통통 튕기기", shake: "살짝 흔들기",
};
export const EFFECT_KEYFRAMES = `
  @keyframes popup-fx-sparkle { 0%, 100% { opacity: 0; transform: scale(0.4) rotate(0deg); } 50% { opacity: 1; transform: scale(1) rotate(20deg); } }
  @keyframes popup-fx-heart   { 0% { opacity: 0; transform: translateY(0) scale(0.6); } 15% { opacity: 1; } 100% { opacity: 0; transform: translateY(-60px) scale(1.1); } }
  @keyframes popup-fx-bounce  { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  @keyframes popup-fx-shake   { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-6deg); } 75% { transform: rotate(6deg); } }
`;
// 이미지 위에 얹는 오버레이 요소(스팬)들 — sparkle/hearts용, 위치 배치용 순수 함수
export function EffectOverlay({ effect }: { effect: string }) {
  if (effect === "sparkle") {
    return (
      <>
        {[
          { top: "-10%", left: "-8%", delay: "0s", size: 16 },
          { top: "-6%", left: "88%", delay: "0.5s", size: 12 },
          { top: "78%", left: "-10%", delay: "1s", size: 12 },
          { top: "85%", left: "90%", delay: "1.5s", size: 16 },
        ].map((s, i) => (
          <span key={i} style={{
            position: "absolute", top: s.top, left: s.left, fontSize: s.size,
            pointerEvents: "none", zIndex: 902,
            animation: `popup-fx-sparkle 2.2s ease-in-out ${s.delay} infinite`,
          }}>✨</span>
        ))}
      </>
    );
  }
  if (effect === "hearts") {
    return (
      <>
        {[
          { left: "10%", delay: "0s", size: 14 },
          { left: "45%", delay: "0.7s", size: 18 },
          { left: "75%", delay: "1.4s", size: 14 },
        ].map((s, i) => (
          <span key={i} style={{
            position: "absolute", bottom: "0%", left: s.left, fontSize: s.size,
            pointerEvents: "none", zIndex: 902,
            animation: `popup-fx-heart 2.4s ease-in ${s.delay} infinite`,
          }}>💗</span>
        ))}
      </>
    );
  }
  return null;
}

// "오늘 하루 보지 않기"는 팝업별로 기억 — 다른 팝업으로 교체되면 다시 노출됨
const dismissKey = (id: string) => `popup_dismissed_${id}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
// 랜덤 페이지 모드에서 "이번 방문엔 어느 페이지에 숨을지" — 방문(세션) 내내 유지돼야
// 페이지를 옮겨다니며 찾을 수 있으므로 sessionStorage 사용
const huntKey = (id: string) => `popup_hunt_page_${id}`;

export default function PopupBanner({
  popup, pageKey, disabled = false, alreadyFound = false, onFound,
}: {
  popup: PopupData;
  pageKey: string;
  disabled?: boolean;      // 이벤트가 꺼져 있는 등 노출하면 안 되는 상태
  alreadyFound?: boolean;  // 이미 찾은 고양이 — 다시 노출하지 않음
  onFound?: (code: string) => void;
}) {
  const isFloating = popup.display_type === "floating";
  const huntCode = popup.hunt_code || null;
  const sizePx = popup.size_px || DEFAULT_SIZE[isFloating ? "floating" : "modal"];
  // 오늘(KST) 날짜에 맞는 문구 오버라이드가 있으면 그걸, 없으면 기본 내용을 사용 — 호버 설명·고정형 텍스트 등 모든 표시에 공통 적용
  const effectiveContent = resolveEffectiveContent(popup);

  // SSR 시엔 항상 닫힌 상태로 시작 — localStorage는 클라이언트에서만 읽을 수 있어 hydration 불일치 방지
  const [open, setOpen] = useState(false);
  // 고정형(floating) 이미지는 content가 화면에 안 보이므로, 호버 시 설명을 툴팁으로 노출
  const [hovering, setHovering] = useState(false);
  // 랜덤 위치는 접속할 때마다 새로 뽑음 (고양이 찾기 같은 이벤트용).
  // 서버에서 정하면 캐시·hydration 문제가 생기므로 클라이언트에서만 계산
  const [randomPos, setRandomPos] = useState<{ top: string; left: string } | null>(null);
  const tooltipClamp = useEdgeClampedCenter(hovering);

  useEffect(() => {
    if (popup.position === "random") {
      // 헤더(상단)·화면 밖으로 나가지 않는 안전 영역 안에서만 배치
      setRandomPos({
        top:  `${18 + Math.random() * 60}%`,
        left: `${5 + Math.random() * 72}%`,
      });
    }
  }, [popup.id, popup.position]);

  useEffect(() => {
    if (disabled || alreadyFound) { setOpen(false); return; }
    // 이 페이지가 노출 대상인지 먼저 확인
    const allowed = popup.pages?.length ? popup.pages : ["home"];
    if (!allowed.includes(pageKey)) return;

    // 랜덤 페이지 모드: 이번 방문에 당첨된 페이지 한 곳에서만 노출
    if (popup.random_page && allowed.length > 1) {
      let hidden: string | null = null;
      try {
        hidden = sessionStorage.getItem(huntKey(popup.id));
        if (!hidden || !allowed.includes(hidden)) {
          hidden = allowed[Math.floor(Math.random() * allowed.length)];
          sessionStorage.setItem(huntKey(popup.id), hidden);
        }
      } catch {
        // 스토리지 차단 시 매 페이지 랜덤 판정으로 대체
        hidden = allowed[Math.floor(Math.random() * allowed.length)];
      }
      if (hidden !== pageKey) return;
    }

    // 고정형(floating)은 닫는 기능 자체가 없으므로 dismiss 기록을 보지 않고 항상 노출
    if (isFloating) { setOpen(true); return; }
    try {
      if (localStorage.getItem(dismissKey(popup.id)) === todayStr()) return;
    } catch {
      // 스토리지 차단 환경에서는 그냥 노출
    }
    setOpen(true);
  }, [popup.id, popup.pages, popup.random_page, pageKey, isFloating, disabled, alreadyFound]);

  if (!open) return null;

  // position("top/middle/bottom-left/center/right" | "random" | "custom") → 실제 배치 CSS.
  // 모달·고정형 둘 다 같은 좌표계를 쓰므로 공유.
  function resolvePlace(margin: number, topOffset: number): React.CSSProperties {
    if (popup.position === "random") {
      // 랜덤 위치가 아직 안 정해졌으면(첫 렌더) 화면 밖으로 — 왼쪽 위에 잠깐 튀는 것 방지
      if (!randomPos) return { top: "-9999px", left: "-9999px" };
      return { top: randomPos.top, left: randomPos.left };
    }
    if (popup.position === "custom") {
      // 관리자가 미리보기를 클릭해 찍은 지점 — 그 점이 팝업 중심이 되도록 이동
      const x = popup.pos_x ?? 50;
      const y = popup.pos_y ?? 50;
      return { top: `${y}%`, left: `${x}%`, transform: "translate(-50%, -50%)" };
    }
    const [row = "bottom", col = "right"] = popup.position.split("-");
    const translate = [
      row === "middle" ? "translateY(-50%)" : "",
      col === "center" ? "translateX(-50%)" : "",
    ].filter(Boolean).join(" ");
    return {
      // 상단은 헤더에 가리지 않도록 아래로 내려서 배치
      ...(row === "top" ? { top: topOffset } : row === "middle" ? { top: "50%" } : { bottom: margin }),
      ...(col === "left" ? { left: margin } : col === "center" ? { left: "50%" } : { right: margin }),
      ...(translate ? { transform: translate } : {}),
    };
  }

  function close() {
    setOpen(false);
  }

  function dismissToday() {
    try {
      localStorage.setItem(dismissKey(popup.id), todayStr());
    } catch {
      // 저장 실패해도 닫기는 되어야 함
    }
    setOpen(false);
  }

  // 이미지 위 장식 효과 — 고정형·팝업형 공통. bounce/shake는 배치용 transform과 겹치면 안 되므로
  // 이미지를 감싸는 안쪽 래퍼에만 건다(고정형은 위치 이동, 팝업형은 딱히 이동이 없어 영향 없음)
  const effect = popup.effect || "none";
  const effectAnimation =
    effect === "bounce" ? "popup-fx-bounce 1.2s ease-in-out infinite"
    : effect === "shake" ? "popup-fx-shake 1.6s ease-in-out infinite"
    : undefined;

  const media = (
    <>
      {popup.image_url && (
        <div
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          style={{ position: "relative" }}
        >
          {effect !== "none" && (
            <>
              <style>{EFFECT_KEYFRAMES}</style>
              <EffectOverlay effect={effect} />
            </>
          )}
          {/* 외부 스토리지 URL이라 next/image 최적화 대상이 아님 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={popup.image_url}
            alt={popup.title}
            style={{ display: "block", width: "100%", height: "auto", animation: effectAnimation }}
          />
          {effectiveContent && hovering && (
            <div ref={tooltipClamp.ref} style={{
              position: "absolute", bottom: "100%", ...tooltipClamp.style,
              marginBottom: 8, padding: "10px 14px", width: "max-content", maxWidth: "min(280px, 90vw)",
              background: "rgba(0,0,0,0.85)", color: "#fff",
              fontSize: "clamp(0.8rem, 3.2vw, 0.92rem)", fontWeight: 500, lineHeight: 1.55, borderRadius: 10,
              whiteSpace: "pre-wrap", textAlign: "center", wordBreak: "keep-all",
              pointerEvents: "none", zIndex: 901,
            }}>
              {effectiveContent}
            </div>
          )}
        </div>
      )}
      {effectiveContent && (
        <p style={{
          margin: 0,
          padding: "18px 20px",
          fontSize: "0.9rem",
          lineHeight: 1.7,
          color: "var(--on-surface)",
          whiteSpace: "pre-wrap",
        }}>
          {effectiveContent}
        </p>
      )}
    </>
  );

  // ── 고정형: 화면에 상시 노출, 닫기 없음 ──
  if (isFloating) {
    // 랜덤 위치가 아직 안 정해졌으면(첫 렌더) 그리지 않음 — 왼쪽 위에 잠깐 튀는 것 방지
    if (popup.position === "random" && !randomPos) return null;
    const place = resolvePlace(20, 110);
    const inner = popup.image_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={popup.image_url}
        alt={popup.title}
        style={{ display: "block", width: "100%", height: "auto", animation: effectAnimation }}
      />
    ) : (
      <span style={{
        display: "block", padding: "12px 18px", fontSize: "0.85rem", fontWeight: 700,
        color: "#fff", background: "var(--primary)", borderRadius: 999, whiteSpace: "nowrap",
      }}>
        {effectiveContent}
      </span>
    );

    return (
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          position: "fixed", ...place, zIndex: 900,
          // vw 기준이라 데스크톱(화면 자체가 넓음)엔 사실상 영향 없고, 좁은 모바일 화면에서만 더 작게 축소됨
          width: `min(${sizePx}px, 55vw)`,
          filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.2))",
        }}
      >
        {popup.image_url && effect !== "none" && (
          <>
            <style>{EFFECT_KEYFRAMES}</style>
            <EffectOverlay effect={effect} />
          </>
        )}
        {popup.image_url && effectiveContent && hovering && (
          <div ref={tooltipClamp.ref} style={{
            position: "absolute", bottom: "100%", ...tooltipClamp.style,
            marginBottom: 8, padding: "10px 14px", width: "max-content", maxWidth: "min(260px, 78vw)",
            background: "rgba(0,0,0,0.85)", color: "#fff",
            fontSize: "clamp(0.8rem, 3.2vw, 0.92rem)", fontWeight: 500, lineHeight: 1.55, borderRadius: 10,
            whiteSpace: "pre-wrap", textAlign: "center", wordBreak: "keep-all",
            pointerEvents: "none", zIndex: 901,
          }}>
            {effectiveContent}
          </div>
        )}
        {huntCode ? (
          // 찾기 이벤트: 링크로 보내지 않고 코드를 알려준 뒤 사라짐
          <button
            onClick={() => { setOpen(false); onFound?.(huntCode); }}
            title="클릭!"
            style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "pointer" }}
          >
            {inner}
          </button>
        ) : popup.link_url ? (
          <a href={popup.link_url} target="_blank" rel="noopener noreferrer"
            title={popup.title} style={{ display: "block", textDecoration: "none" }}>
            {inner}
          </a>
        ) : inner}
        {/* 고정형은 원래 상시노출(닫기 없음)이지만, 방해될 때 지금 화면에서만 잠깐 치울 수 있게 —
            새로고침·재방문하면 다시 노출됨(오늘 하루 보지 않기처럼 영구 저장하지 않음) */}
        <button
          onClick={() => setOpen(false)}
          title="닫기"
          style={{
            position: "absolute", top: -8, right: -8, width: 20, height: 20,
            borderRadius: "50%", border: "1px solid var(--surface-container-highest)",
            background: "#fff", color: "var(--on-surface-variant)",
            fontSize: 12, lineHeight: 1, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)", zIndex: 903, padding: 0,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  // ── 모달형: 배경은 어둡게 깔리고, 대화상자는 선택한 위치에 노출. 닫기·오늘 하루 보지 않기 제공 ──
  // 랜덤 위치가 아직 안 정해졌으면(첫 렌더) 그리지 않음 — 왼쪽 위에 잠깐 튀는 것 방지
  if (popup.position === "random" && !randomPos) return null;
  const modalPlace = resolvePlace(20, 110);
  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", ...modalPlace,
          background: "#fff",
          borderRadius: 12,
          overflow: "hidden",
          width: `min(${sizePx}px, calc(100vw - 40px))`,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        {popup.link_url ? (
          <a
            href={popup.link_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", textDecoration: "none" }}
          >
            {media}
          </a>
        ) : media}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px",
          borderTop: "1px solid var(--surface-container-high)",
          background: "var(--surface-container-low)",
        }}>
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: "0.78rem", color: "var(--on-surface-variant)", cursor: "pointer",
          }}>
            <input
              type="checkbox"
              onChange={(e) => { if (e.target.checked) dismissToday(); }}
              style={{ width: 14, height: 14, cursor: "pointer" }}
            />
            오늘 하루 보지 않기
          </label>
          <button
            onClick={close}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "0.78rem", fontWeight: 600, color: "var(--on-surface)",
              padding: "4px 8px",
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
