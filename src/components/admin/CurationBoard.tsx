"use client";

import { useState, useRef } from "react";
import { GripVertical, Eye, EyeOff, ArrowUp, ArrowDown, Trash2, ExternalLink } from "lucide-react";
import { NewsItem } from "@/lib/types";

type Props = {
  initialNews: NewsItem[];
};

export default function CurationBoard({ initialNews }: Props) {
  const [items, setItems] = useState<NewsItem[]>(initialNews);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"published" | "staging">("published");

  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  const published = items.filter((i) => i.is_published);
  const staging = items.filter((i) => !i.is_published);
  const activeList = tab === "published" ? published : staging;

  /* ── drag & drop ── */
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverIdx.current = idx; };
  const handleDragEnd = () => {
    const from = dragIdx.current;
    const to = dragOverIdx.current;
    if (from === null || to === null || from === to) return;

    const listIds = activeList.map((i) => i.id);
    const reordered = [...listIds];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    setItems((prev) => {
      const otherIds = prev.filter((i) => i.is_published !== (tab === "published")).map((i) => i.id);
      const allOrdered = tab === "published"
        ? [...reordered, ...otherIds]
        : [...otherIds, ...reordered];

      const idxMap = new Map(allOrdered.map((id, i) => [id, i + 1]));
      return prev
        .map((item) => ({ ...item, display_order: idxMap.get(item.id) ?? item.display_order }))
        .sort((a, b) => a.display_order - b.display_order);
    });
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  /* ── actions ── */
  const togglePublish = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, is_published: !item.is_published } : item
      )
    );
  };

  const moveItem = (id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr.map((item, i) => ({ ...item, display_order: i + 1 }));
    });
  };

  const remove = (id: string) => {
    if (!confirm("이 기사를 삭제할까요?")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/save-curation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("저장 실패");
    } catch (e) {
      alert("저장 중 오류가 발생했습니다.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const CATEGORIES = [...new Set(items.map((i) => i.category))];
  const [filterCat, setFilterCat] = useState("ALL");
  const filtered = activeList.filter((i) => filterCat === "ALL" || i.category === filterCat);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0">큐레이션 보드</h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            드래그로 순서를 조정하고 발행 상태를 관리합니다
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-9 px-5 rounded-md text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          {saving ? "저장 중..." : "변경사항 저장"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg w-fit" style={{ background: "var(--surface-container-highest)" }}>
        {(["published", "staging"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{
              background: tab === t ? "var(--surface-container-lowest)" : "transparent",
              color: tab === t ? "var(--on-surface)" : "var(--on-surface-variant)",
              boxShadow: tab === t ? "0 1px 4px rgba(26,28,29,0.06)" : "none",
            }}
          >
            {t === "published" ? `발행됨 (${published.length})` : `대기열 (${staging.length})`}
          </button>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {["ALL", ...CATEGORIES].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className="px-3 py-1 rounded-full text-[0.7rem] font-semibold tracking-wide uppercase transition-colors"
            style={{
              background: filterCat === cat ? "var(--primary)" : "var(--surface-container-highest)",
              color: filterCat === cat ? "#fff" : "var(--on-surface-variant)",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2">
        {filtered.map((item, idx) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            className="flex items-start gap-3 p-4 rounded-lg cursor-grab active:cursor-grabbing transition-shadow"
            style={{
              background: "var(--surface-container-lowest)",
              boxShadow: "0 1px 3px rgba(26,28,29,0.04)",
            }}
          >
            {/* drag handle */}
            <GripVertical size={16} className="mt-1 flex-shrink-0" style={{ color: "var(--on-surface-variant)" }} />

            {/* content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}
                >
                  {item.category}
                </span>
                <span className="text-[0.65rem]" style={{ color: "var(--on-surface-variant)" }}>
                  #{item.display_order}
                </span>
              </div>
              <p className="font-semibold text-sm leading-snug m-0 truncate" style={{ color: "var(--on-surface)" }}>
                {item.title}
              </p>
              <p className="text-xs mt-1 m-0 line-clamp-1" style={{ color: "var(--on-surface-variant)" }}>
                {item.summary_short}
              </p>
            </div>

            {/* actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                title="위로"
                onClick={() => moveItem(item.id, -1)}
                className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                <ArrowUp size={14} style={{ color: "var(--on-surface-variant)" }} />
              </button>
              <button
                title="아래로"
                onClick={() => moveItem(item.id, 1)}
                className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                <ArrowDown size={14} style={{ color: "var(--on-surface-variant)" }} />
              </button>
              <a
                href={item.original_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
                style={{ display: "flex" }}
              >
                <ExternalLink size={14} style={{ color: "var(--on-surface-variant)" }} />
              </a>
              <button
                title={item.is_published ? "발행 취소" : "발행"}
                onClick={() => togglePublish(item.id)}
                className="p-1.5 rounded transition-colors"
                style={{
                  background: item.is_published ? "rgba(0,0,0,0.06)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {item.is_published
                  ? <Eye size={14} style={{ color: "var(--on-surface)" }} />
                  : <EyeOff size={14} style={{ color: "var(--on-surface-variant)" }} />
                }
              </button>
              <button
                title="삭제"
                onClick={() => remove(item.id)}
                className="p-1.5 rounded hover:bg-red-50 transition-colors"
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                <Trash2 size={14} style={{ color: "#dc2626" }} />
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div
            className="flex items-center justify-center py-16 rounded-lg text-sm"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}
          >
            {tab === "staging" ? "대기 중인 기사가 없습니다." : "발행된 기사가 없습니다."}
          </div>
        )}
      </div>
    </div>
  );
}
