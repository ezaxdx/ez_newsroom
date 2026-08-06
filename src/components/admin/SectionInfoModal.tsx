"use client";

import { useState } from "react";
import { X } from "lucide-react";

export default function SectionInfoModal({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="설명 보기"
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 20, height: 20, fontSize: 11, fontWeight: 700, lineHeight: 1,
          background: "var(--surface-container-high)", color: "var(--on-surface-variant)",
          border: "1px solid var(--surface-container-highest)", cursor: "pointer", flexShrink: 0,
        }}
      >
        ?
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.35)", zIndex: 999 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl"
            style={{
              background: "#ffffff", width: "100%", maxWidth: 480, maxHeight: "80vh",
              display: "flex", flexDirection: "column",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            }}
          >
            <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid #ececec", flexShrink: 0 }}>
              <p className="font-bold m-0" style={{ color: "#1a1a1a", fontSize: 17 }}>{title}</p>
              <button
                onClick={() => setOpen(false)}
                className="flex items-center justify-center rounded-full"
                style={{ width: 26, height: 26, border: "none", background: "#f0f0f0", color: "#666", cursor: "pointer", flexShrink: 0 }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: "18px 22px 22px", overflowY: "auto", color: "#333", fontSize: 14.5, lineHeight: 1.75 }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
