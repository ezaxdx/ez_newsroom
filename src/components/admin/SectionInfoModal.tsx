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
          width: 18, height: 18, fontSize: 10, fontWeight: 700, lineHeight: 1,
          background: "var(--surface-container-high)", color: "var(--on-surface-variant)",
          border: "1px solid var(--surface-container-highest)", cursor: "pointer", flexShrink: 0,
        }}
      >
        ?
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.25)", zIndex: 999 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl p-6"
            style={{ background: "#ffffff", width: "90%", maxWidth: 460, boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold m-0" style={{ color: "#1a1a1a", fontSize: 18 }}>{title}</p>
              <button
                onClick={() => setOpen(false)}
                className="flex items-center justify-center rounded"
                style={{ width: 24, height: 24, border: "none", background: "var(--surface-container-high)", color: "var(--on-surface-variant)", cursor: "pointer" }}
              >
                <X size={13} />
              </button>
            </div>
            <div style={{ color: "#333", fontSize: 13.5, lineHeight: 1.6 }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
