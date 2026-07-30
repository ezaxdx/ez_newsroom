"use client";

import { useState, useEffect, useCallback } from "react";
import PopupBanner, { type PopupData } from "./PopupBanner";
import type { EventSettings } from "@/lib/popup";

// 찾은 고양이 코드 보관 — 브라우저를 닫아도 유지돼야 며칠에 걸쳐 모을 수 있음
const FOUND_KEY = "hunt_found_codes";

function readFound(): string[] {
  try {
    const raw = localStorage.getItem(FOUND_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function PopupLayer({
  popups,
  event,
  pageKey,
}: {
  popups: PopupData[];
  event: EventSettings | null;
  pageKey: string;
}) {
  const [found, setFound] = useState<string[]>([]);
  const [justFound, setJustFound] = useState<string | null>(null);
  // localStorage는 클라이언트에서만 읽을 수 있어 마운트 후 반영 (hydration 불일치 방지)
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFound(readFound());
    setReady(true);
  }, []);

  const handleFound = useCallback((code: string) => {
    setFound((prev) => {
      if (prev.includes(code)) return prev;
      const next = [...prev, code];
      try { localStorage.setItem(FOUND_KEY, JSON.stringify(next)); } catch { /* 저장 실패해도 화면엔 반영 */ }
      return next;
    });
    setJustFound(code);
  }, []);

  const huntOn = !!event?.enabled && (event?.total ?? 0) > 0;

  return (
    <>
      {popups.map((p) => (
        <PopupBanner
          key={p.id}
          popup={p}
          pageKey={pageKey}
          // 이벤트가 꺼져 있으면 고양이는 아예 노출하지 않음
          disabled={!!p.hunt_code && !huntOn}
          alreadyFound={ready && !!p.hunt_code && found.includes(p.hunt_code)}
          onFound={handleFound}
        />
      ))}

      {/* 방금 찾았을 때 뜨는 코드 안내 */}
      {justFound && (
        <div
          onClick={() => setJustFound(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 14, padding: "28px 32px",
              textAlign: "center", maxWidth: 320, width: "100%",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
          >
            <p style={{ margin: "0 0 6px", fontSize: "1.4rem" }}>🎉</p>
            <p style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 700 }}>고양이를 찾았습니다!</p>
            <p style={{ margin: "0 0 14px", fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
              아래 코드를 적어두세요. 응모할 때 필요합니다.
            </p>
            <p style={{
              margin: "0 0 16px", padding: "10px 14px", borderRadius: 8,
              background: "var(--surface-container-high)",
              fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.04em",
            }}>
              {justFound}
            </p>
            <p style={{ margin: "0 0 16px", fontSize: "0.78rem", color: "var(--on-surface-variant)" }}>
              지금까지 {found.length} / {event?.total ?? 0}마리 발견
            </p>
            <button
              onClick={() => setJustFound(null)}
              style={{
                padding: "8px 20px", borderRadius: 6, border: "none",
                background: "var(--primary)", color: "#fff",
                fontSize: "0.82rem", fontWeight: 700, cursor: "pointer",
              }}
            >
              계속 찾기
            </button>
          </div>
        </div>
      )}

      {/* 진행률 + 응모 버튼 — 이벤트 켜져 있고 한 마리 이상 찾았을 때만 */}
      {ready && huntOn && found.length > 0 && (
        <div style={{
          position: "fixed", left: 20, bottom: 20, zIndex: 890,
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", borderRadius: 999,
          background: "rgba(0,0,0,0.82)", color: "#fff",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, whiteSpace: "nowrap" }}>
            🐱 {found.length} / {event?.total ?? 0} 발견
          </span>
          {event?.form_url && (
            <a
              href={event.form_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: "0.75rem", fontWeight: 700, color: "#000",
                background: "#fff", padding: "4px 12px", borderRadius: 999,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              응모하기
            </a>
          )}
        </div>
      )}
    </>
  );
}
