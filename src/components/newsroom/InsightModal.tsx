"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { NewsItem } from "@/lib/types";
import { logEvent, logReadTimeBeacon } from "@/lib/analytics";

type Props = {
  item: NewsItem | null;
  onClose: () => void;
};

const MAX_READ_SEC = 600; // 10분 — 이상치 방어 (자리비움 등으로 과도하게 긴 값 캡)

export default function InsightModal({ item, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // onClose를 ref로 감싸 이벤트 리스너 재등록 방지
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // ── 열람 시간 측정 ──
  // 탭이 보이는 동안만 누적(백그라운드/자리비움 시간 제외) + 탭 닫기·이탈도 beacon으로 포착
  const prevItemRef       = useRef<NewsItem | null>(null);
  const accumulatedSecRef = useRef(0);
  const visibleSinceRef   = useRef<number | null>(null);

  const flushVisibleSegment = () => {
    if (visibleSinceRef.current != null) {
      accumulatedSecRef.current += (Date.now() - visibleSinceRef.current) / 1000;
      visibleSinceRef.current = null;
    }
  };
  const computeTotalSec = () => {
    let sec = accumulatedSecRef.current;
    if (visibleSinceRef.current != null) sec += (Date.now() - visibleSinceRef.current) / 1000;
    return Math.min(Math.round(sec), MAX_READ_SEC);
  };

  useEffect(() => {
    if (item) {
      // 모달 열림 — 누적 초기화, 탭이 지금 보이는 상태라면 그때부터 카운트 시작
      accumulatedSecRef.current = 0;
      visibleSinceRef.current = typeof document !== "undefined" && document.visibilityState === "visible"
        ? Date.now() : null;
    } else if (prevItemRef.current) {
      // 명시적으로 닫힘(X·배경클릭·ESC) — 마지막 구간 반영 후 일반 로깅
      flushVisibleSegment();
      const sec = computeTotalSec();
      if (sec >= 1) {
        logEvent({ event_type: "read_time", news_id: prevItemRef.current.id, read_sec: sec });
      }
      accumulatedSecRef.current = 0;
    }
    prevItemRef.current = item;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // 탭 포커스 전환 — 백그라운드 동안은 타이머 정지, 복귀 시 재개
  useEffect(() => {
    const handleVisibility = () => {
      if (!prevItemRef.current) return; // 모달 닫혀있으면 무관
      if (document.hidden) flushVisibleSegment();
      else if (visibleSinceRef.current == null) visibleSinceRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // 탭 닫기·다른 사이트 이동 — React 클로즈 이펙트가 못 도는 케이스라 beacon으로 별도 포착
  useEffect(() => {
    const handlePageHide = () => {
      if (!prevItemRef.current) return;
      flushVisibleSegment();
      const sec = computeTotalSec();
      if (sec >= 1) logReadTimeBeacon(prevItemRef.current.id, sec);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [item]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onCloseRef.current();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []); // 마운트 시 1회만 등록

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const bounds = dialogRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const outside =
      e.clientX < bounds.left ||
      e.clientX > bounds.right ||
      e.clientY < bounds.top ||
      e.clientY > bounds.bottom;
    if (outside) onClose();
  };

  const handleOutboundClick = () => {
    if (item) logEvent({ event_type: "outbound_click", news_id: item.id });
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      style={{
        border: "none",
        padding: 0,
        background: "transparent",
        width: "min(680px, 92vw)",
        maxHeight: "90vh",
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        margin: 0,
      }}
      className="backdrop:bg-[rgba(26,28,29,0.38)] backdrop:backdrop-blur-[4px]"
    >
      {item && (
        <article
          className="relative flex flex-col gap-4 rounded-xl p-7 overflow-y-auto max-h-[88vh]"
          style={{
            background: "var(--surface-container-lowest)",
            boxShadow: "0 18px 48px rgba(26,28,29,0.06)",
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-5 right-5 flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-[--surface-container-highest]"
            style={{ background: "transparent", border: "none", cursor: "pointer" }}
            aria-label="닫기"
          >
            <X size={16} style={{ color: "var(--on-surface-variant)" }} />
          </button>

          <p className="m-0 text-[0.72rem] font-semibold tracking-[0.05em] uppercase"
            style={{ color: "var(--on-surface-variant)" }}>
            {item.category}
          </p>

          <h3 className="m-0 font-bold leading-[1.3] tracking-[-0.02em]"
            style={{ fontSize: "1.4rem", color: "var(--on-surface)" }}>
            {item.title}
          </h3>

          <div>
            <p className="mt-0 mb-1 text-[0.72rem] font-semibold tracking-[0.05em] uppercase"
              style={{ color: "var(--on-surface-variant)" }}>
              Summary
            </p>
            <p className="m-0 text-sm leading-relaxed" style={{ color: "var(--on-surface-variant)" }}>
              {item.content_long}
            </p>
          </div>

          {item.implications && (
            <div className="rounded-md p-4" style={{ background: "var(--surface-container-low)" }}>
              <p className="mt-0 mb-1 text-[0.72rem] font-semibold tracking-[0.05em] uppercase"
                style={{ color: "var(--on-surface-variant)" }}>
                Expert Insight
              </p>
              <p className="m-0 text-sm leading-relaxed" style={{ color: "var(--on-surface)" }}>
                {item.implications}
              </p>
            </div>
          )}

          <a
            href={item.original_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleOutboundClick}
            className="self-start text-[0.78rem] font-bold tracking-[0.04em] uppercase transition-all hover:underline"
            style={{ color: "var(--on-surface)", textDecoration: "none" }}
          >
            VIEW ORIGINAL SOURCE →
          </a>
        </article>
      )}
    </dialog>
  );
}
