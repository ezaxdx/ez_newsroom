"use client";

import { useState, useEffect } from "react";

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
};

// "오늘 하루 보지 않기"는 팝업별로 기억 — 다른 팝업으로 교체되면 다시 노출됨
const dismissKey = (id: string) => `popup_dismissed_${id}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
// 랜덤 페이지 모드에서 "이번 방문엔 어느 페이지에 숨을지" — 방문(세션) 내내 유지돼야
// 페이지를 옮겨다니며 찾을 수 있으므로 sessionStorage 사용
const huntKey = (id: string) => `popup_hunt_page_${id}`;

export default function PopupBanner({ popup, pageKey }: { popup: PopupData; pageKey: string }) {
  const isFloating = popup.display_type === "floating";

  // SSR 시엔 항상 닫힌 상태로 시작 — localStorage는 클라이언트에서만 읽을 수 있어 hydration 불일치 방지
  const [open, setOpen] = useState(false);
  // 랜덤 위치는 접속할 때마다 새로 뽑음 (고양이 찾기 같은 이벤트용).
  // 서버에서 정하면 캐시·hydration 문제가 생기므로 클라이언트에서만 계산
  const [randomPos, setRandomPos] = useState<{ top: string; left: string } | null>(null);

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
  }, [popup.id, popup.pages, popup.random_page, pageKey, isFloating]);

  if (!open) return null;

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

  const media = (
    <>
      {popup.image_url && (
        // 외부 스토리지 URL이라 next/image 최적화 대상이 아님
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={popup.image_url}
          alt={popup.title}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      )}
      {popup.content && (
        <p style={{
          margin: 0,
          padding: "18px 20px",
          fontSize: "0.9rem",
          lineHeight: 1.7,
          color: "var(--on-surface)",
          whiteSpace: "pre-wrap",
        }}>
          {popup.content}
        </p>
      )}
    </>
  );

  // ── 고정형: 화면에 상시 노출, 닫기 없음 ──
  if (isFloating) {
    // position은 "세로-가로" 조합(top/middle/bottom × left/center/right) 또는 "random"
    let place: React.CSSProperties;
    if (popup.position === "random") {
      // 랜덤 위치가 아직 안 정해졌으면(첫 렌더) 그리지 않음 — 왼쪽 위에 잠깐 튀는 것 방지
      if (!randomPos) return null;
      place = { top: randomPos.top, left: randomPos.left };
    } else {
      const [row = "bottom", col = "right"] = popup.position.split("-");
      const translate = [
        row === "middle" ? "translateY(-50%)" : "",
        col === "center" ? "translateX(-50%)" : "",
      ].filter(Boolean).join(" ");
      place = {
        // 상단은 헤더에 가리지 않도록 아래로 내려서 배치
        ...(row === "top" ? { top: 110 } : row === "middle" ? { top: "50%" } : { bottom: 20 }),
        ...(col === "left" ? { left: 20 } : col === "center" ? { left: "50%" } : { right: 20 }),
        ...(translate ? { transform: translate } : {}),
      };
    }
    const inner = popup.image_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={popup.image_url}
        alt={popup.title}
        style={{ display: "block", width: "100%", height: "auto" }}
      />
    ) : (
      <span style={{
        display: "block", padding: "12px 18px", fontSize: "0.85rem", fontWeight: 700,
        color: "#fff", background: "var(--primary)", borderRadius: 999, whiteSpace: "nowrap",
      }}>
        {popup.content}
      </span>
    );

    return (
      <div
        style={{
          position: "fixed", ...place, zIndex: 900,
          width: "min(150px, 35vw)",
          filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.2))",
        }}
      >
        {popup.link_url ? (
          <a href={popup.link_url} target="_blank" rel="noopener noreferrer"
            title={popup.title} style={{ display: "block", textDecoration: "none" }}>
            {inner}
          </a>
        ) : inner}
      </div>
    );
  }

  // ── 모달형: 가운데 팝업, 닫기·오늘 하루 보지 않기 제공 ──
  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          overflow: "hidden",
          width: "100%",
          maxWidth: 420,
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
