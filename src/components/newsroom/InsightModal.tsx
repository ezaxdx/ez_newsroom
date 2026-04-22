"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { NewsItem } from "@/lib/types";
import { logEvent } from "@/lib/analytics";

type Props = {
  item: NewsItem | null;
  onClose: () => void;
};

export default function InsightModal({ item, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

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
