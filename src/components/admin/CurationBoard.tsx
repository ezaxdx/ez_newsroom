"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  GripVertical, Eye, EyeOff, ArrowUp, ArrowDown, Trash2,
  ExternalLink, Sparkles, Loader2, RefreshCw,
} from "lucide-react";
import { NewsItem } from "@/lib/types";

type Tab = "live" | "staging" | "archive";

type Props = {
  initialNews: NewsItem[];
  qualityThresholds?: { auto_publish: number; staging: number };
  displayWindowDays?: number;
};

function makeWindowMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}

function isLive(item: NewsItem, windowMs: number) {
  return item.is_published && Date.now() - new Date(item.published_at).getTime() < windowMs;
}
function isArchive(item: NewsItem, windowMs: number) {
  return item.is_published && Date.now() - new Date(item.published_at).getTime() >= windowMs;
}

export default function CurationBoard({
  initialNews,
  qualityThresholds = { auto_publish: 8, staging: 5 },
  displayWindowDays = 4,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<NewsItem[]>(initialNews);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [republishIds, setRepublishIds] = useState<string[]>([]);

  useEffect(() => {
    setItems(initialNews);
    setDeletedIds([]);
    setRepublishIds([]);
  }, [initialNews]);

  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  // 탭별 기사 분류
  const windowMs = makeWindowMs(displayWindowDays);
  const live = items.filter((i) => isLive(i, windowMs));
  const staging = items.filter((i) => !i.is_published);
  const archive = items.filter((i) => isArchive(i, windowMs));

  const tabMeta: { key: Tab; label: string; count: number }[] = [
    { key: "live",    label: "메인 표시 중", count: live.length },
    { key: "staging", label: "대기열",       count: staging.length },
    { key: "archive", label: "아카이브",     count: archive.length },
  ];

  // ── 드래그 (메인 표시 중만) ──
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverIdx.current = idx; };
  const handleDragEnd = () => {
    const from = dragIdx.current;
    const to = dragOverIdx.current;
    if (from === null || to === null || from === to) return;

    const liveIds = live.map((i) => i.id);
    const reordered = [...liveIds];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    setItems((prev) => {
      const otherIds = prev.filter((i) => !isLive(i, windowMs)).map((i) => i.id);
      const allOrdered = [...reordered, ...otherIds];
      const idxMap = new Map(allOrdered.map((id, i) => [id, i + 1]));
      return prev
        .map((item) => ({ ...item, display_order: idxMap.get(item.id) ?? item.display_order }))
        .sort((a, b) => a.display_order - b.display_order);
    });
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  // ── actions ──
  const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
  const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
    Beginner:     { bg: "var(--surface-container-highest)", color: "var(--on-surface-variant)" },
    Intermediate: { bg: "rgba(26,28,29,0.75)",             color: "#fff" },
    Advanced:     { bg: "var(--primary)",                  color: "#fff" },
  };

  const cycleLevel = (id: string) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const cur = item.level ?? "Intermediate";
      const next = LEVELS[(LEVELS.indexOf(cur as typeof LEVELS[number]) + 1) % LEVELS.length];
      return { ...item, level: next };
    }));
  };

  const togglePublish = (id: string) => {
    setItems((prev) =>
      prev.map((item) => item.id === id ? { ...item, is_published: !item.is_published } : item)
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
    setDeletedIds((prev) => [...prev, id]);
  };

  // 아카이브 → 메인 재발행
  const republish = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, published_at: new Date().toISOString() }
          : item
      )
    );
    setRepublishIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/save-curation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, deletedIds, republishIds }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setRepublishIds([]);
    } catch (e) {
      alert("저장 중 오류가 발생했습니다.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleRunCuration = async () => {
    if (!confirm("RSS 피드에서 새 기사를 수집하고 AI로 생성합니다. 진행할까요?")) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/admin/run-curation", { method: "POST" });
      const text = await res.text();
      let json: Record<string, unknown>;
      try { json = JSON.parse(text); }
      catch { throw new Error("서버 응답 오류 — 실행 시간 초과일 수 있습니다. RSS 소스 수를 줄이거나 잠시 후 다시 시도해주세요."); }
      if (!res.ok) throw new Error((json.error as string) ?? "실패");
      setRunResult(`✅ 생성 ${json.created}건 / 중복 건너뜀 ${json.skipped}건 / 실패 ${json.failed}건`);
      router.refresh();
    } catch (e) {
      setRunResult(`❌ ${e instanceof Error ? e.message : "오류 발생"}`);
    } finally {
      setRunning(false);
    }
  };

  // ── 카테고리 필터 ──
  const activeList = tab === "live" ? live : tab === "staging" ? staging : archive;
  const CATEGORIES = [...new Set(items.map((i) => i.category))];
  const [filterCat, setFilterCat] = useState("ALL");
  const filtered = activeList.filter((i) => filterCat === "ALL" || i.category === filterCat);

  // 아카이브 날짜별 그룹핑 (최신순)
  const archiveGroups: { dateLabel: string; dateMs: number; items: NewsItem[] }[] = [];
  if (tab === "archive") {
    const grouped: Record<string, { dateMs: number; items: NewsItem[] }> = {};
    for (const item of filtered) {
      const d = new Date(item.published_at);
      const dateMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const key = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
      if (!grouped[key]) grouped[key] = { dateMs, items: [] };
      grouped[key].items.push(item);
    }
    for (const [dateLabel, { dateMs, items }] of Object.entries(grouped)) {
      // 그룹 내 기사도 최신순
      items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
      archiveGroups.push({ dateLabel, dateMs, items });
    }
    // 날짜 그룹 최신순
    archiveGroups.sort((a, b) => b.dateMs - a.dateMs);
  }

  const hasPendingChanges = deletedIds.length > 0 || republishIds.length > 0;

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
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunCuration}
            disabled={running}
            className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {running ? "수집 중..." : "AI 큐레이션 실행"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-5 rounded-md text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
          >
            {saving ? "저장 중..." : hasPendingChanges ? "변경사항 저장 •" : "변경사항 저장"}
          </button>
        </div>
      </div>

      {/* 큐레이션 실행 결과 */}
      {runResult && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm"
          style={{ background: "var(--surface-container-lowest)", color: "var(--on-surface)" }}>
          {runResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg w-fit" style={{ background: "var(--surface-container-highest)" }}>
        {tabMeta.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{
              background: tab === key ? "var(--surface-container-lowest)" : "transparent",
              color: tab === key ? "var(--on-surface)" : "var(--on-surface-variant)",
              boxShadow: tab === key ? "0 1px 4px rgba(26,28,29,0.06)" : "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {label}
            <span
              className="ml-1.5 px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold"
              style={{
                background: tab === key
                  ? key === "live" ? "var(--primary)" : "var(--surface-container-highest)"
                  : "transparent",
                color: tab === key && key === "live" ? "#fff" : "var(--on-surface-variant)",
              }}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* 메인 표시 중 안내 */}
      {tab === "live" && (
        <div className="mb-4 px-3 py-2 rounded-md text-xs flex items-center gap-2"
          style={{ background: "rgba(var(--primary-rgb, 26,115,232),0.07)", color: "var(--primary)" }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--primary)" }} />
          발행 후 {displayWindowDays}일 이내 기사가 메인 페이지에 표시됩니다 · 현재 {live.length}건 노출 중
        </div>
      )}

      {/* 아카이브 안내 */}
      {tab === "archive" && (
        <div className="mb-4 px-3 py-2 rounded-md text-xs flex items-center gap-2"
          style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
          <RefreshCw size={11} />
          메인 페이지에서 내려간 기사입니다. 재발행하면 오늘 날짜로 메인에 다시 올라갑니다.
        </div>
      )}

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
              border: "none",
              cursor: "pointer",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ── 메인 표시 중 / 대기열 카드 목록 ── */}
      {tab !== "archive" && (
        <div className="flex flex-col gap-2">
          {filtered.map((item, idx) => (
            <ArticleCard
              key={item.id}
              item={item}
              idx={idx}
              tab={tab}
              qualityThresholds={qualityThresholds}
              onDragStart={handleDragStart}
              onDragEnter={handleDragEnter}
              onDragEnd={handleDragEnd}
              onCycleLevel={cycleLevel}
              onTogglePublish={togglePublish}
              onMove={moveItem}
              onRemove={remove}
              onRepublish={republish}
              LEVEL_STYLE={LEVEL_STYLE}
            />
          ))}
          {filtered.length === 0 && (
            <EmptyState tab={tab} />
          )}
        </div>
      )}

      {/* ── 아카이브: 날짜별 그룹 ── */}
      {tab === "archive" && (
        <div className="flex flex-col gap-6">
          {archiveGroups.length === 0 && <EmptyState tab="archive" />}
          {archiveGroups.map(({ dateLabel, items: groupItems }) => (
            <div key={dateLabel}>
              <div className="flex items-center gap-3 mb-2">
                <p className="text-[0.72rem] font-semibold tracking-wide m-0"
                  style={{ color: "var(--on-surface-variant)" }}>
                  {dateLabel}
                </p>
                <div className="flex-1 h-px" style={{ background: "var(--surface-container-highest)" }} />
              </div>
              <div className="flex flex-col gap-2">
                {groupItems.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    idx={0}
                    tab="archive"
                    qualityThresholds={qualityThresholds}
                    onDragStart={() => {}}
                    onDragEnter={() => {}}
                    onDragEnd={() => {}}
                    onCycleLevel={cycleLevel}
                    onTogglePublish={togglePublish}
                    onMove={moveItem}
                    onRemove={remove}
                    onRepublish={republish}
                    LEVEL_STYLE={LEVEL_STYLE}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 카드 컴포넌트 ── */
function ArticleCard({
  item, idx, tab, qualityThresholds,
  onDragStart, onDragEnter, onDragEnd,
  onCycleLevel, onTogglePublish, onMove, onRemove, onRepublish,
  LEVEL_STYLE,
}: {
  item: NewsItem;
  idx: number;
  tab: Tab;
  qualityThresholds: { auto_publish: number; staging: number };
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDragEnd: () => void;
  onCycleLevel: (id: string) => void;
  onTogglePublish: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onRepublish: (id: string) => void;
  LEVEL_STYLE: Record<string, { bg: string; color: string }>;
}) {
  const isDraggable = tab === "live";

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? () => onDragStart(idx) : undefined}
      onDragEnter={isDraggable ? () => onDragEnter(idx) : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onDragOver={isDraggable ? (e) => e.preventDefault() : undefined}
      className="flex items-start gap-3 p-4 rounded-lg transition-shadow"
      style={{
        background: "var(--surface-container-lowest)",
        boxShadow: "0 1px 3px rgba(26,28,29,0.04)",
        cursor: isDraggable ? "grab" : "default",
      }}
    >
      {/* drag handle */}
      <GripVertical
        size={16}
        className="mt-1 flex-shrink-0"
        style={{ color: isDraggable ? "var(--on-surface-variant)" : "transparent" }}
      />

      {/* content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}
          >
            {item.category}
          </span>
          <button
            title="클릭해서 레벨 변경"
            onClick={() => onCycleLevel(item.id)}
            className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase transition-all"
            style={{
              background: LEVEL_STYLE[item.level ?? "Intermediate"]?.bg ?? "var(--surface-container-highest)",
              color: LEVEL_STYLE[item.level ?? "Intermediate"]?.color ?? "var(--on-surface-variant)",
              border: "none",
              cursor: "pointer",
            }}
          >
            {item.level ?? "Intermediate"}
          </button>
          {item.quality_score != null && (
            <span
              className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide"
              style={{
                background: item.quality_score >= qualityThresholds.auto_publish
                  ? "var(--primary)"
                  : item.quality_score >= qualityThresholds.staging
                  ? "rgba(26,28,29,0.15)"
                  : "var(--surface-container-highest)",
                color: item.quality_score >= qualityThresholds.auto_publish ? "#fff" : "var(--on-surface-variant)",
              }}
              title={`자동발행 기준: ${qualityThresholds.auto_publish}점 / 대기열 기준: ${qualityThresholds.staging}점`}
            >
              ★ {item.quality_score}
            </span>
          )}
          {tab === "staging" && item.created_at &&
            Date.now() - new Date(item.created_at).getTime() < 48 * 60 * 60 * 1000 && (
            <span className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
              style={{ background: "#16a34a", color: "#fff" }}>
              NEW
            </span>
          )}
          {tab !== "archive" && (
            <span className="text-[0.65rem]" style={{ color: "var(--on-surface-variant)" }}>
              #{item.display_order}
            </span>
          )}
          {tab === "archive" && (
            <span className="text-[0.65rem]" style={{ color: "var(--on-surface-variant)" }}>
              {new Date(item.published_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
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
        {tab === "live" && (
          <>
            <button title="위로" onClick={() => onMove(item.id, -1)}
              className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <ArrowUp size={14} style={{ color: "var(--on-surface-variant)" }} />
            </button>
            <button title="아래로" onClick={() => onMove(item.id, 1)}
              className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <ArrowDown size={14} style={{ color: "var(--on-surface-variant)" }} />
            </button>
          </>
        )}

        {tab === "archive" && (
          <button
            title="재발행 (오늘 날짜로 메인에 다시 올리기)"
            onClick={() => onRepublish(item.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[0.7rem] font-semibold transition-colors"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}
          >
            <RefreshCw size={11} /> 재발행
          </button>
        )}

        <a href={item.original_url} target="_blank" rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
          style={{ display: "flex" }}>
          <ExternalLink size={14} style={{ color: "var(--on-surface-variant)" }} />
        </a>

        {tab !== "archive" && (
          <button
            title={item.is_published ? "발행 취소" : "발행"}
            onClick={() => onTogglePublish(item.id)}
            className="p-1.5 rounded transition-colors"
            style={{
              background: item.is_published ? "rgba(0,0,0,0.06)" : "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            {item.is_published
              ? <Eye size={14} style={{ color: "var(--on-surface)" }} />
              : <EyeOff size={14} style={{ color: "var(--on-surface-variant)" }} />}
          </button>
        )}

        <button title="삭제" onClick={() => onRemove(item.id)}
          className="p-1.5 rounded hover:bg-red-50 transition-colors"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          <Trash2 size={14} style={{ color: "#dc2626" }} />
        </button>
      </div>
    </div>
  );
}

/* ── 빈 상태 ── */
function EmptyState({ tab }: { tab: Tab }) {
  const msg = tab === "live"
    ? "메인 페이지에 표시 중인 기사가 없습니다."
    : tab === "staging"
    ? "대기 중인 기사가 없습니다."
    : "아카이브된 기사가 없습니다.";
  return (
    <div className="flex items-center justify-center py-16 rounded-lg text-sm"
      style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
      {msg}
    </div>
  );
}
