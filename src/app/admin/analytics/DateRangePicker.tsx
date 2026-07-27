"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

// 페이지(page.tsx)의 defaultWeekRange()와 동일한 로직 — 파라미터 없을 때 표시할 기본값(이번 주)
function getWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now); mon.setDate(now.getDate() - diff);
  return { from: mon.toISOString().split("T")[0], to: now.toISOString().split("T")[0] };
}
function getMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
    to: now.toISOString().split("T")[0],
  };
}

export default function DateRangePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const isAll = sp.get("range") === "all";
  const paramFrom = sp.get("from");
  const paramTo = sp.get("to");
  const hasParamRange = Boolean(paramFrom || paramTo);
  // 파라미터가 아예 없으면(최초 진입) 기본값인 이번 주를 그대로 보여줌
  const week = getWeekRange();
  const [from, setFrom] = useState(isAll ? "" : paramFrom ?? (hasParamRange ? "" : week.from));
  const [to, setTo]     = useState(isAll ? "" : paramTo   ?? (hasParamRange ? "" : week.to));

  function apply(f: string, t: string) {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    router.push(`/admin/analytics${p.size ? "?" + p.toString() : ""}`);
  }

  function setPreset(preset: "week" | "month" | "all") {
    if (preset === "all") { setFrom(""); setTo(""); router.push("/admin/analytics?range=all"); return; }
    const { from: f, to: t } = preset === "week" ? getWeekRange() : getMonthRange();
    setFrom(f); setTo(t); apply(f, t);
  }

  // 현재 표시 중인 값이 어느 프리셋과 일치하는지로 활성 버튼 판별
  const week2 = getWeekRange();
  const month2 = getMonthRange();
  const activePreset: "week" | "month" | "all" | null = isAll
    ? "all"
    : from === week2.from && to === week2.to ? "week"
    : from === month2.from && to === month2.to ? "month"
    : null;

  const inputStyle: React.CSSProperties = {
    height: 32, padding: "0 8px", borderRadius: 6, fontSize: 13,
    border: "1px solid var(--surface-container-highest)",
    background: "var(--surface-container-low)",
    color: "var(--on-surface)", outline: "none",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {/* 빠른 선택 */}
      {(["week", "month", "all"] as const).map((p) => {
        const labels = { all: "전체", month: "이번 달", week: "이번 주" };
        const active = activePreset === p;
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
