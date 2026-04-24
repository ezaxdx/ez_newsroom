"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Rss, Link } from "lucide-react";
import { RssSource } from "@/lib/types";

const EMPTY_FORM = {
  url: "",
  source_name: "",
  weight: 3,
  default_category: "AI",
  source_type: "rss" as "rss" | "url",
};

const TYPE_META = {
  rss: {
    label: "RSS 피드",
    icon: Rss,
    bg: "var(--surface-container-highest)",
    color: "var(--on-surface-variant)",
    placeholder: "https://example.com/feed.xml",
    hint: "RSS/Atom 피드 URL. 소스당 최대 3개 기사를 자동 수집합니다.",
  },
  url: {
    label: "직접 URL",
    icon: Link,
    bg: "var(--primary)",
    color: "#fff",
    placeholder: "https://example.com/article",
    hint: "개별 기사 URL. 큐레이션 실행 시 해당 페이지를 직접 분석해 기사 1건을 생성합니다.",
  },
};

export default function RssPage() {
  const [sources, setSources] = useState<RssSource[]>([]);
  const [categories, setCategories] = useState<string[]>(["AI", "MICE", "TOURISM"]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ── 초기 로드 ──
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/rss").then((r) => r.json()),
      fetch("/api/admin/categories").then((r) => r.json()),
    ]).then(([rssData, catData]) => {
      setSources(rssData.data ?? []);
      setCategories(catData.categories ?? ["AI", "MICE", "TOURISM"]);
    }).finally(() => setLoading(false));
  }, []);

  // ── 토글 ──
  const toggleActive = async (source: RssSource) => {
    setSources((prev) => prev.map((s) => s.id === source.id ? { ...s, is_active: !s.is_active } : s));
    await fetch("/api/admin/rss", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, is_active: !source.is_active }),
    });
  };

  // ── 삭제 ──
  const remove = async (id: string) => {
    if (!confirm("이 소스를 삭제할까요?")) return;
    setSources((prev) => prev.filter((s) => s.id !== id));
    await fetch("/api/admin/rss", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  // ── 추가 ──
  const addSource = async () => {
    if (!form.url || !form.source_name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, is_active: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSources((prev) => [...prev, json.data]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e) {
      alert("추가 실패: " + (e instanceof Error ? e.message : "오류"));
    } finally {
      setSaving(false);
    }
  };

  // 유형별 소스 분리
  const rssSources = sources.filter((s) => (s.source_type ?? "rss") === "rss");
  const urlSources = sources.filter((s) => s.source_type === "url");

  const meta = TYPE_META[form.source_type];

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0">RSS 소스 매니저</h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            RSS 피드와 개별 기사 URL을 함께 관리합니다
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          <Plus size={14} /> 소스 추가
        </button>
      </div>

      {/* ── 추가 폼 ── */}
      {showForm && (
        <div
          className="p-5 rounded-lg mb-6 flex flex-col gap-4"
          style={{ background: "var(--surface-container-lowest)", boxShadow: "0 2px 12px rgba(26,28,29,0.06)" }}
        >
          <h3 className="text-sm font-semibold m-0">새 소스 등록</h3>

          {/* 유형 선택 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
              소스 유형
            </label>
            <div className="flex gap-2">
              {(["rss", "url"] as const).map((type) => {
                const m = TYPE_META[type];
                const Icon = m.icon;
                const isSelected = form.source_type === type;
                return (
                  <button
                    key={type}
                    onClick={() => setForm((f) => ({ ...f, source_type: type, url: "" }))}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      background: isSelected ? "var(--primary)" : "var(--surface-container-low)",
                      color: isSelected ? "#fff" : "var(--on-surface-variant)",
                      border: `1.5px solid ${isSelected ? "var(--primary)" : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    <Icon size={13} />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[0.7rem] m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
              {meta.hint}
            </p>
          </div>

          {/* 입력 필드 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                {form.source_type === "rss" ? "RSS URL" : "기사 URL"}
              </label>
              <input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder={meta.placeholder}
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
                placeholder={form.source_type === "rss" ? "TechCrunch" : "기사 제목 또는 출처"}
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
                {categories.map((c) => <option key={c}>{c}</option>)}
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
              disabled={saving || !form.url || !form.source_name}
              className="flex items-center gap-2 h-8 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              추가
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="h-8 px-4 rounded-md text-sm font-medium"
              style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* ── 소스 목록 ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--on-surface-variant)" }} />
        </div>
      ) : sources.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm rounded-lg"
          style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
          등록된 소스가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* RSS 피드 섹션 */}
          {rssSources.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Rss size={13} style={{ color: "var(--on-surface-variant)" }} />
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
                  style={{ color: "var(--on-surface-variant)" }}>
                  RSS 피드 <span className="ml-1 opacity-60">({rssSources.length})</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {rssSources.map((source) => (
                  <SourceCard key={source.id} source={source} onToggle={toggleActive} onRemove={remove} />
                ))}
              </div>
            </section>
          )}

          {/* 직접 URL 섹션 */}
          {urlSources.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Link size={13} style={{ color: "var(--on-surface-variant)" }} />
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
                  style={{ color: "var(--on-surface-variant)" }}>
                  직접 URL <span className="ml-1 opacity-60">({urlSources.length})</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {urlSources.map((source) => (
                  <SourceCard key={source.id} source={source} onToggle={toggleActive} onRemove={remove} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 소스 카드 컴포넌트 ── */
function SourceCard({
  source,
  onToggle,
  onRemove,
}: {
  source: RssSource;
  onToggle: (s: RssSource) => void;
  onRemove: (id: string) => void;
}) {
  const type = source.source_type ?? "rss";
  const Icon = TYPE_META[type].icon;

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-lg transition-opacity"
      style={{ background: "var(--surface-container-lowest)", opacity: source.is_active ? 1 : 0.5 }}
    >
      {/* 유형 아이콘 */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
        style={{
          background: type === "url" ? "var(--primary)" : "var(--surface-container-highest)",
        }}
      >
        <Icon size={13} style={{ color: type === "url" ? "#fff" : "var(--on-surface-variant)" }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-semibold text-sm m-0">{source.source_name}</p>
          <span className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
            {source.default_category}
          </span>
        </div>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs truncate block transition-opacity hover:opacity-60"
          style={{ color: "var(--on-surface-variant)", textDecoration: "none", maxWidth: "38ch" }}
          title={source.url}
        >
          {source.url}
        </a>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--on-surface-variant)" }}>가중치</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="w-1.5 h-4 rounded-sm"
              style={{ background: i < source.weight ? "var(--primary)" : "var(--surface-container-highest)" }} />
          ))}
        </div>
        <span className="text-xs font-bold w-4">{source.weight}</span>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={() => onToggle(source)} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          {source.is_active
            ? <ToggleRight size={20} style={{ color: "var(--primary)" }} />
            : <ToggleLeft size={20} style={{ color: "var(--on-surface-variant)" }} />}
        </button>
        <button onClick={() => onRemove(source.id)} className="p-1.5 rounded"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          <Trash2 size={14} style={{ color: "#dc2626" }} />
        </button>
      </div>
    </div>
  );
}
