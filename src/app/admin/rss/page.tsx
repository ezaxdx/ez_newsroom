"use client";

import { useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { RssSource } from "@/lib/types";

const MOCK_SOURCES: RssSource[] = [
  { id: "1", url: "https://feeds.feedburner.com/TechCrunch", source_name: "TechCrunch", weight: 3, default_category: "AI", is_active: true },
  { id: "2", url: "https://www.meetingstoday.com/rss", source_name: "Meetings Today", weight: 5, default_category: "MICE", is_active: true },
  { id: "3", url: "https://skift.com/feed", source_name: "Skift", weight: 4, default_category: "TOURISM", is_active: true },
  { id: "4", url: "https://www.travelweekly.com/rss", source_name: "Travel Weekly", weight: 3, default_category: "TOURISM", is_active: false },
];

const CATEGORIES = ["AI", "MICE", "TOURISM", "STARTUP", "POLICY", "OPERATIONS", "INDUSTRY"];

export default function RssPage() {
  const [sources, setSources] = useState<RssSource[]>(MOCK_SOURCES);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ url: "", source_name: "", weight: 3, default_category: "AI" });

  const toggleActive = (id: string) =>
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, is_active: !s.is_active } : s));

  const remove = (id: string) => {
    if (!confirm("이 소스를 삭제할까요?")) return;
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  const addSource = () => {
    if (!form.url || !form.source_name) return;
    setSources((prev) => [
      ...prev,
      { id: Date.now().toString(), ...form, is_active: true },
    ]);
    setForm({ url: "", source_name: "", weight: 3, default_category: "AI" });
    setShowForm(false);
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0">RSS 소스 매니저</h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            수집 소스별 신뢰도 가중치와 기본 카테고리를 설정합니다
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          <Plus size={14} /> 소스 추가
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div
          className="p-5 rounded-lg mb-5 flex flex-col gap-3"
          style={{ background: "var(--surface-container-lowest)", boxShadow: "0 2px 12px rgba(26,28,29,0.06)" }}
        >
          <h3 className="text-sm font-semibold m-0">새 RSS 소스</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>RSS URL</label>
              <input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/feed"
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>소스명</label>
              <input
                value={form.source_name}
                onChange={(e) => setForm((f) => ({ ...f, source_name: e.target.value }))}
                placeholder="TechCrunch"
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>기본 카테고리</label>
              <select
                value={form.default_category}
                onChange={(e) => setForm((f) => ({ ...f, default_category: e.target.value }))}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
              >
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                신뢰도 가중치 ({form.weight})
              </label>
              <input
                type="range" min={1} max={10} value={form.weight}
                onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))}
                className="w-full mt-2"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={addSource}
              className="h-8 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              추가
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="h-8 px-4 rounded-md text-sm font-medium transition-colors"
              style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)" }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Source list */}
      <div className="flex flex-col gap-2">
        {sources.map((source) => (
          <div
            key={source.id}
            className="flex items-center gap-4 p-4 rounded-lg transition-opacity"
            style={{
              background: "var(--surface-container-lowest)",
              opacity: source.is_active ? 1 : 0.5,
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-semibold text-sm m-0" style={{ color: "var(--on-surface)" }}>
                  {source.source_name}
                </p>
                <span
                  className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}
                >
                  {source.default_category}
                </span>
              </div>
              <p className="text-xs m-0 truncate" style={{ color: "var(--on-surface-variant)" }}>
                {source.url}
              </p>
            </div>

            {/* Weight bar */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--on-surface-variant)" }}>
                가중치
              </span>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className="w-1.5 h-4 rounded-sm"
                    style={{ background: i < source.weight ? "var(--primary)" : "var(--surface-container-highest)" }}
                  />
                ))}
              </div>
              <span className="text-xs font-bold w-4">{source.weight}</span>
            </div>

            {/* Toggle + Delete */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleActive(source.id)}
                className="p-1.5 rounded transition-colors"
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
                title={source.is_active ? "비활성화" : "활성화"}
              >
                {source.is_active
                  ? <ToggleRight size={20} style={{ color: "var(--primary)" }} />
                  : <ToggleLeft size={20} style={{ color: "var(--on-surface-variant)" }} />
                }
              </button>
              <button
                onClick={() => remove(source.id)}
                className="p-1.5 rounded hover:bg-red-50 transition-colors"
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                <Trash2 size={14} style={{ color: "#dc2626" }} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
