"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  GripVertical, Eye, EyeOff, ArrowUp, ArrowDown, Trash2,
  ExternalLink, Sparkles, Loader2, RefreshCw, TrendingUp,
} from "lucide-react";
import { NewsItem } from "@/lib/types";
import { calcLastScheduledRun } from "@/lib/schedule";

type Tab = "live" | "staging" | "archive";

const DAY_KO: Record<number, string> = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };

function formatScheduleDays(days: number[]): string {
  if (!days || days.length === 0) return "";
  return [...days].sort((a, b) => a - b).map((d) => DAY_KO[d] ?? "").join("·");
}

/** KST 날짜+시간을 서버/클라이언트 동일하게 포맷 (locale 의존 없음) */
function formatKSTDateTime(ms: number): string {
  // UTC+9 offset 적용
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const ampm = hours < 12 ? "오전" : "오후";
  const h = hours % 12 || 12;
  const mm = String(minutes).padStart(2, "0");
  return `${month}월 ${day}일 ${ampm} ${h}:${mm}`;
}

type Props = {
  initialNews: NewsItem[];
  qualityThresholds?: { auto_publish: number; staging: number };
  displayWindowDays?: number;
  scheduleDays?: number[];
  scheduleHour?: number;
  scheduleEnabled?: boolean;
  navCategories?: string[];
};


function isLive(item: NewsItem, lastRunMs: number) {
  return item.is_published && new Date(item.published_at).getTime() >= lastRunMs;
}
function isArchive(item: NewsItem, lastRunMs: number) {
  return item.is_published && new Date(item.published_at).getTime() < lastRunMs;
}

export default function CurationBoard({
  initialNews,
  qualityThresholds = { auto_publish: 8, staging: 5 },
  displayWindowDays = 4,
  scheduleDays = [],
  scheduleHour = 9,
  scheduleEnabled = false,
  navCategories,
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
  // 스케줄이 활성화된 경우: 마지막 예약 실행 이후 발행분 = LIVE
  // 스케줄 없는 경우: 최근 displayWindowDays일 이내 발행분 = LIVE
  const lastRunMs = scheduleEnabled && scheduleDays.length > 0
    ? calcLastScheduledRun(scheduleDays, scheduleHour).getTime()
    : Date.now() - displayWindowDays * 24 * 60 * 60 * 1000;
  const live = items.filter((i) => isLive(i, lastRunMs));
  const staging = items.filter((i) => !i.is_published);
  const archive = items.filter((i) => isArchive(i, lastRunMs));

  // Top News 계산 (카테고리별 display_order 가장 낮은 live 기사)
  const categories = navCategories ?? [...new Set(live.map((i) => i.category))];
  const topNewsMap = new Map<string, NewsItem>();
  const sortedLive = [...live].sort((a, b) => a.display_order - b.display_order);
  for (const cat of categories) {
    const found = sortedLive.find((i) => i.category === cat);
    if (found) topNewsMap.set(cat, found);
  }
  const topNewsIds = new Set(Array.from(topNewsMap.values()).map((i) => i.id));

  // live 탭: 카테고리 순서(navCategories) → 카테고리 내 display_order
  const liveSortedByCat = [...live].sort((a, b) => {
    const ai = categories.indexOf(a.category);
    const bi = categories.indexOf(b.category);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.display_order - b.display_order;
  });

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

    const liveIds = liveSortedByCat.map((i) => i.id);
    const reordered = [...liveIds];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    setItems((prev) => {
      const otherIds = prev.filter((i) => !isLive(i, lastRunMs)).map((i) => i.id);
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
      setDeletedIds([]);
      setRepublishIds([]);
      router.refresh(); // 홈 페이지 캐시 무효화 + 어드민 데이터 갱신
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
      catch { throw new Error(`서버 응답 파싱 실패 (status: ${res.status})\n${text.slice(0, 300)}`); }
      if (!res.ok) throw new Error((json.error as string) ?? `HTTP ${res.status}`);
      if (json.message) {
        setRunResult(`⏳ ${json.message}`);
      } else {
        setRunResult(`✅ 생성 ${json.created}건 / 중복 건너뜀 ${json.skipped}건 / 실패 ${json.failed}건`);
      }
      router.refresh();
    } catch (e) {
      setRunResult(`❌ ${e instanceof Error ? e.message : "오류 발생"}`);
    } finally {
      setRunning(false);
    }
  };

  // ── 카테고리 필터 ──
  const activeList = tab === "live" ? liveSortedByCat : tab === "staging" ? staging : archive;
  const CATEGORIES = [...new Set(items.map((i) => i.category))];
  const [filterCat, setFilterCat] = useState("ALL");
  const filtered = activeList.filter((i) => filterCat === "ALL" || i.category === filterCat);

  // 아카이브 날짜별 그룹핑 (KST 기준, 최신순)
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const archiveGroups: { dateLabel: string; dateMs: number; items: NewsItem[] }[] = [];
  if (tab === "archive") {
    const grouped: Record<string, { dateMs: number; items: NewsItem[] }> = {};
    for (const item of filtered) {
      const dKST = new Date(new Date(item.published_at).getTime() + KST_OFFSET_MS);
      // KST 자정 기준으로 그룹핑
      const dateMs = new Date(dKST.getUTCFullYear(), dKST.getUTCMonth(), dKST.getUTCDate()).getTime();
      const key = `${dKST.getUTCFullYear()}년 ${dKST.getUTCMonth() + 1}월 ${dKST.getUTCDate()}일`;
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

      {/* ── Top News 현황 패널 ── */}
      <div className="mb-6 p-4 rounded-xl" style={{ background: "var(--surface-container-lowest)", border: "1px solid var(--surface-container-high)" }}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} style={{ color: "var(--primary)" }} />
          <span className="text-xs font-bold tracking-wide uppercase" style={{ color: "var(--primary)" }}>
            현재 Top News (히어로 슬라이드)
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {categories.map((cat) => {
            const top = topNewsMap.get(cat);
            return (
              <div key={cat} className="flex items-center gap-2 text-xs">
                <span
                  className="w-16 px-2 py-0.5 rounded-full text-center font-bold tracking-wide uppercase flex-shrink-0"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", fontSize: "0.6rem" }}
                >
                  {cat}
                </span>
                {top ? (
                  <span className="truncate font-medium" style={{ color: "var(--on-surface)" }}>
                    {top.title}
                  </span>
                ) : (
                  <span style={{ color: "var(--on-surface-variant)" }}>— 표시 중인 기사 없음</span>
                )}
              </div>
            );
          })}
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
          {scheduleEnabled && scheduleDays.length > 0
            ? `가장 최근 ${formatScheduleDays(scheduleDays)} 큐레이션(${formatKSTDateTime(lastRunMs)}) 이후 기사가 표시됩니다 · 현재 ${live.length}건 노출 중`
            : `발행 후 ${displayWindowDays}일 이내 기사가 메인 페이지에 표시됩니다 · 현재 ${live.length}건 노출 중`
          }
        </div>
      )}

      {/* 아카이브 안내 */}
      {tab === "archive" && (
        <div className="mb-4 px-3 py-2 rounded-md text-xs flex items-center gap-2"
          style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
          <RefreshCw size={11} />
          <span>
            {formatKSTDateTime(lastRunMs)} 이전 발행 기사입니다 (이전 큐레이션 배치).
            재발행하면 오늘 날짜로 메인에 다시 올라갑니다.
          </span>
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
          {tab === "live" && filtered.length > 0
            ? (() => {
                let prevCat = "";
                return filtered.map((item, idx) => {
                  const showHeader = item.category !== prevCat && filterCat === "ALL";
                  if (showHeader) prevCat = item.category;
                  return (
                    <div key={item.id}>
                      {showHeader && (
                        <div className="flex items-center gap-3 mt-3 mb-1 first:mt-0">
                          <span
                            className="text-[0.65rem] font-bold tracking-[0.1em] uppercase"
                            style={{ color: "var(--on-surface-variant)" }}
                          >
                            {item.category}
                          </span>
                          <div className="flex-1 h-px" style={{ background: "var(--surface-container-highest)" }} />
                        </div>
                      )}
                      <ArticleCard
                        item={item}
                        idx={idx}
                        tab={tab}
                        qualityThresholds={qualityThresholds}
                        isTopNews={topNewsIds.has(item.id)}
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
                    </div>
                  );
                });
              })()
            : filtered.map((item, idx) => (
                <ArticleCard
                  key={item.id}
                  item={item}
                  idx={idx}
                  tab={tab}
                  qualityThresholds={qualityThresholds}
                  isTopNews={topNewsIds.has(item.id)}
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
              ))
          }
          {filtered.length === 0 && <EmptyState tab={tab} />}
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
                    isTopNews={false}
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
  item, idx, tab, qualityThresholds, isTopNews,
  onDragStart, onDragEnter, onDragEnd,
  onCycleLevel, onTogglePublish, onMove, onRemove, onRepublish,
  LEVEL_STYLE,
}: {
  item: NewsItem;
  idx: number;
  tab: Tab;
  qualityThresholds: { auto_publish: number; staging: number };
  isTopNews: boolean;
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
        background: isTopNews ? "rgba(var(--primary-rgb, 26,115,232),0.04)" : "var(--surface-container-lowest)",
        boxShadow: isTopNews ? "0 0 0 1.5px var(--primary)" : "0 1px 3px rgba(26,28,29,0.04)",
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
          {isTopNews && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              <TrendingUp size={9} /> TOP
            </span>
          )}
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
                cursor: item.quality_criteria ? "help" : "default",
              }}
              title={item.quality_criteria
                ? `관련성 ${item.quality_criteria.relevance} · 구체성 ${item.quality_criteria.specificity} · 실용성 ${item.quality_criteria.practicality} · 원문품질 ${item.quality_criteria.source_quality}\n자동발행 기준: ${qualityThresholds.auto_publish}점 / 대기열 기준: ${qualityThresholds.staging}점`
                : `자동발행 기준: ${qualityThresholds.auto_publish}점 / 대기열 기준: ${qualityThresholds.staging}점`}
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
              {formatKSTDateTime(new Date(item.published_at).getTime())}
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
