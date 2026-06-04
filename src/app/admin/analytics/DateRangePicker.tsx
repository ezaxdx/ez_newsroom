"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

export default function DateRangePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");

  function apply(f: string, t: string) {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    router.push(`/admin/analytics${p.size ? "?" + p.toString() : ""}`);
  }

  function setPreset(preset: "week" | "month" | "all") {
    const now = new Date();
    if (preset === "all") { setFrom(""); setTo(""); apply("", ""); return; }
    if (preset === "week") {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const mon = new Date(now); mon.setDate(now.getDate() - diff);
      const f = mon.toISOString().split("T")[0];
      const t = now.toISOString().split("T")[0];
      setFrom(f); setTo(t); apply(f, t);
    }
    if (preset === "month") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const t = now.toISOString().split("T")[0];
      setFrom(f); setTo(t); apply(f, t);
    }
  }

  const inputStyle: React.CSSProperties = {
    height: 32, padding: "0 8px", borderRadius: 6, fontSize: 13,
    border: "1px solid var(--surface-container-highest)",
    background: "var(--surface-container-low)",
    color: "var(--on-surface)", outline: "none",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {/* 빠른 선택 */}
      {(["all", "month", "week"] as const).map((p) => {
        const labels = { all: "전체", month: "이번 달", week: "이번 주" };
        const active = p === "all" ? (!from && !to) : false;
        return (
          <button key={p} onClick={() => setPreset(p)}
            style={{
              height: 32, padding: "0 12px", borderRadius: 6, fontSize: 13,
              fontWeight: active ? 700 : 400, border: "none", cursor: "pointer",
              background: active ? "var(--primary)" : "var(--surface-container-highest)",
              color: active ? "#fff" : "var(--on-surface-variant)",
            }}
          >{labels[p]}</button>
        );
      })}
      <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>|</span>
      {/* 날짜 직접 입력 */}
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
      <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>~</span>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
      <button
        onClick={() => apply(from, to)}
        style={{
          height: 32, padding: "0 14px", borderRadius: 6, fontSize: 13,
          fontWeight: 600, border: "none", cursor: "pointer",
          background: "var(--primary)", color: "#fff",
        }}
      >조회</button>
    </div>
  );
}
