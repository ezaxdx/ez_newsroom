"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import {
  GripVertical, Eye, EyeOff, ArrowUp, ArrowDown, Trash2,
  ExternalLink, Sparkles, Loader2, RefreshCw, TrendingUp, Pencil, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { NewsItem } from "@/lib/types";
import ArticleImg from "@/components/newsroom/ArticleImg";
import { calcLastScheduledRun } from "@/lib/schedule";
import { HelpTriggerConnected } from "@/components/admin/HelpPanel";
import CategoryEditor, { CategoryChangeDialog, CATEGORY_OPTIONS } from "@/components/admin/CategoryEditor";
import { useTabParam } from "@/lib/useTabParam";

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
  temporaryArchiveEnabled?: boolean;
  qualityThresholds?: { auto_publish: number; staging: number };
  displayWindowDays?: number;
  scheduleDays?: number[];
  scheduleHour?: number;
  scheduleEnabled?: boolean;
  navCategories?: string[];
  lastRunISO?: string;      // "메인 표시 중"과 "아카이브"를 가르는 기준 시각 (서버가 정해서 내려줌)
  archiveTotal?: number;    // 아카이브 전체 건수 — 목록은 "더 보기"로 나눠 읽으므로 건수는 따로 받음
};

const ARCHIVE_PAGE = 30;
type ArchiveList = { ids: string[]; fetched: number; total: number; loading: boolean; error: string | null; loaded: boolean };


function isLive(item: NewsItem, lastRunMs: number) {
  return item.is_published && new Date(item.published_at).getTime() >= lastRunMs;
}
function isArchive(item: NewsItem, lastRunMs: number) {
  return item.is_published && new Date(item.published_at).getTime() < lastRunMs;
}

export default function CurationBoard({
  initialNews,
  temporaryArchiveEnabled = false,
  qualityThresholds = { auto_publish: 8, staging: 5 },
  displayWindowDays = 4,
  scheduleDays = [],
  scheduleHour = 9,
  scheduleEnabled = false,
  navCategories,
  lastRunISO,
  archiveTotal,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<NewsItem[]>(initialNews);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [tab, setTab] = useTabParam<Tab>("tab", "live");
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [republishIds, setRepublishIds] = useState<string[]>([]);
  // 대기열 일괄 처리용 선택 상태
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 저장할 때 "바뀐 것만" 보내려고 처음 읽은 값을 기억 — 아카이브에서 나중에 읽어 온 기사도 여기에 추가됨
  const baselineRef = useRef<Map<string, NewsItem>>(new Map(initialNews.map((n) => [n.id, n])));
  // 아카이브 탭은 카테고리별로 "더 보기"를 따로 이어 읽음 (키: 카테고리, 전체는 ALL)
  const [archiveLists, setArchiveLists] = useState<Record<string, ArchiveList>>({});

  useEffect(() => {
    setItems(initialNews);
    baselineRef.current = new Map(initialNews.map((n) => [n.id, n]));
    setArchiveLists({});
    setDeletedIds([]);
    setRepublishIds([]);
    setSelectedIds(new Set());
  }, [initialNews]);

  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  // 탭별 기사 분류
  // 스케줄이 활성화된 경우: 마지막 예약 실행 이후 발행분 = LIVE
  // 스케줄 없는 경우: 최근 displayWindowDays일 이내 발행분 = LIVE
  const lastRunMs = lastRunISO
    ? Date.parse(lastRunISO)
    : scheduleEnabled && scheduleDays.length > 0
      ? calcLastScheduledRun(scheduleDays, scheduleHour).getTime()
      : Date.now() - displayWindowDays * 24 * 60 * 60 * 1000;
  const live = items.filter((i) => isLive(i, lastRunMs));
  // 대기열은 품질점수 높은 순(동점이면 적합성 fit 높은 순)으로 정렬 — 발행할 만한 것부터 검토
  const staging = items
    .filter((i) => !i.is_published)
    .sort((a, b) =>
      (b.quality_score ?? 0) - (a.quality_score ?? 0) ||
      (b.quality_criteria?.fit ?? 0) - (a.quality_criteria?.fit ?? 0)
    );
  // 아카이브는 지금까지 "더 보기"로 읽어 온 것만 (선택한 카테고리 기준). 재발행·삭제한 기사는 자동으로 빠짐
  const itemsById = new Map(items.map((i) => [i.id, i]));

  // Top News 계산 (카테고리별 display_order 가장 낮은 live 기사)
  const categories = navCategories ?? [...new Set(live.map((i) => i.category))];
  const topNewsMap = new Map<string, NewsItem>();
  const sortedLive = [...live].sort((a, b) => a.display_order - b.display_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
    return a.display_order - b.display_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  // 아카이브 건수: 서버가 센 전체 건수에서, 이 화면에서 재발행·삭제해 아카이브를 벗어난 기사를 뺌
  const archiveLeft = [...baselineRef.current.values()].filter((b) => isArchive(b, lastRunMs) && (() => { const cur = itemsById.get(b.id); return !cur || !isArchive(cur, lastRunMs); })()).length;
  const archiveCount = Math.max(0, (archiveTotal ?? 0) - archiveLeft);

  const tabMeta: { key: Tab; label: string; count: number }[] = [
    { key: "live",    label: "메인 표시 중", count: live.length },
    { key: "staging", label: "대기열",       count: staging.length },
    { key: "archive", label: "아카이브",     count: archiveCount },
  ];

  // ── 드래그 (메인 표시 중만) ──
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverIdx.current = idx; };
  const handleDragEnd = () => {
    const from = dragIdx.current;
    const to = dragOverIdx.current;
    if (from === null || to === null || from === to) return;

    // from/to는 "화면에 보이는 목록(filtered)" 기준 인덱스 — 카테고리 필터가 걸려 있으면
    // 전체 라이브 목록과 인덱스가 어긋나므로 반드시 filtered를 대상으로 계산해야 함
    const visible = filtered;
    if (from >= visible.length || to >= visible.length) return;

    const reordered = visible.map((i) => i.id);
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    setItems((prev) => {
      // 화면에 보이는 기사들에게만 새 순번을 매김(0,1,2...) — 필터로 가려진 기사·아카이브·
      // 대기열의 display_order는 절대 건드리지 않음. 원래 값을 그대로 주고받으면 같은 값을
      // 가진 기사끼리는(큐레이션이 같은 점수로 매긴 경우 흔함) 맞바꿔도 순서가 안 바뀌므로,
      // 매번 새 값을 매겨 확실히 갈라놓음
      const orderMap = new Map(reordered.map((id, i) => [id, i]));
      return prev.map((item) => orderMap.has(item.id) ? { ...item, display_order: orderMap.get(item.id)! } : item);
    });
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  // ── actions ──
  const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
    Beginner:     { bg: "var(--surface-container-highest)", color: "var(--on-surface-variant)" },
    Intermediate: { bg: "rgba(26,28,29,0.75)",             color: "#fff" },
    Advanced:     { bg: "var(--primary)",                  color: "#fff" },
  };

  const togglePublish = (id: string) => {
    setItems((prev) =>
      prev.map((item) => item.id === id ? { ...item, is_published: !item.is_published } : item)
    );
  };

  const moveItem = (id: string, dir: -1 | 1) => {
    setItems((prev) => {
      // 화면에 보이는 목록 기준으로만 이동 — 필터가 걸린 상태에서 화면에 없는 기사와
      // 순서가 바뀌어 엉뚱한 기사의 display_order가 저장되는 것을 방지
      const visible = filtered;
      const idx = visible.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= visible.length) return prev;

      const swapped = visible.map((i) => i.id);
      [swapped[idx], swapped[next]] = [swapped[next], swapped[idx]];
      // 화면에 보이는 기사들에게만 새 순번(0,1,2...)을 매김 — 원래 값을 그대로 주고받으면
      // 같은 값을 가진 기사끼리는(흔함) 맞바꿔도 순서가 안 바뀌므로 매번 새로 매겨 확실히 갈라놓음
      const orderMap = new Map(swapped.map((sid, i) => [sid, i]));
      return prev.map((item) => orderMap.has(item.id) ? { ...item, display_order: orderMap.get(item.id)! } : item);
    });
  };

  // 카테고리 변경·다시 쓰기처럼 서버에 이미 저장된 변경을 화면 목록에 반영
  const patchItem = (id: string, patch: Partial<NewsItem>) => {
    const before = baselineRef.current.get(id);
    if (before) baselineRef.current.set(id, { ...before, ...patch });
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const remove = (id: string) => {
    if (!confirm("이 기사를 삭제할까요?")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDeletedIds((prev) => [...prev, id]);
  };

  // ── 적합성 학습 표시 — 좋은 기사(적합 예시로 쌓기) / 부적합(사유와 함께 예시로 쌓고 재수집 차단 후 삭제) ──
  // 일반 삭제와 달리 다음 큐레이션의 적합성 판정에 반영됨. 서버에 바로 저장(“변경사항 저장” 불필요)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [rejectItem, setRejectItem] = useState<NewsItem | null>(null);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState("");
  const sendFitFeedback = async (id: string, verdict: "good" | "bad", reason?: string) => {
    setFitBusy(true); setFitError("");
    try {
      const res = await fetch("/api/admin/news/fit-feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, verdict, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      if (verdict === "good") setLikedIds((prev) => new Set(prev).add(id));
      else { setItems((prev) => prev.filter((i) => i.id !== id)); setRejectItem(null); }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "저장 실패";
      if (verdict === "good") alert(msg); else setFitError(msg);
      return false;
    } finally {
      setFitBusy(false);
    }
  };
  const markGood = (item: NewsItem) => { if (!likedIds.has(item.id)) void sendFitFeedback(item.id, "good"); };

  // ── 기사 편집 (제목/요약/시사점/이미지 + 카테고리·레벨) — 편집 진입점을 이 창 하나로 모음 ──
  const [editingItem, setEditingItem] = useState<NewsItem | null>(null);
  const [editFocus, setEditFocus] = useState<"category" | "level" | undefined>(undefined);   // 카드의 배지에서 열었을 때 해당 항목으로 이동
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [rewriteFor, setRewriteFor] = useState<{ id: string; target: string } | null>(null);   // "다시 쓰기"를 고른 카테고리 변경

  const [editorWide, setEditorWide] = useState(true);
  const [editorRevision, setEditorRevision] = useState(0);
  const [editorIds, setEditorIds] = useState<string[]>([]);
  const [editNotice, setEditNotice] = useState("");
  const editDirty = useRef(false);
  const rewriteState = useRef({ busy: false, dirty: false });
  const rewritePreviousWide = useRef(false);
  const handleRewriteState = useCallback((state: { busy: boolean; dirty: boolean; comparing: boolean }) => {
    rewriteState.current = { busy: state.busy, dirty: state.dirty };
    if (state.comparing) setEditorWide(true);
  }, []);
  const boardPosition = useRef(0);
  const editorRoot = useRef<HTMLDialogElement>(null);
  const editorOpen = editingItem !== null;
  useEffect(() => {
    if (!editorOpen) return;
    const dialog = editorRoot.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, [editorOpen]);
  useEffect(() => {
    if (!editorOpen) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (editDirty.current || rewriteState.current.dirty || rewriteState.current.busy || editSaving) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [editorOpen, editSaving]);
  const canLeaveEditor = () => {
    if (editSaving || rewriteState.current.busy) return false;
    return !(editDirty.current || rewriteState.current.dirty) || window.confirm("저장하지 않은 수정 내용 또는 적용하지 않은 새 글이 있습니다. 버리고 이동할까요?");
  };
  const openEdit = (item: NewsItem, focus?: "category" | "level") => {
    if (editingItem && !canLeaveEditor()) return;
    if (!editingItem) { boardPosition.current = window.scrollY; setEditorIds(filtered.map(row => row.id)); }
    editDirty.current = false; rewriteState.current = { busy: false, dirty: false };
    setRewriteFor(null); setEditError(""); setEditNotice(""); setEditFocus(focus); setEditingItem(item);
  };
  const closeEditor = () => {
    if (!canLeaveEditor()) return;
    editDirty.current = false; rewriteState.current = { busy: false, dirty: false };
    setEditingItem(null); setRewriteFor(null); setEditorWide(true); setEditError("");
    requestAnimationFrame(() => window.scrollTo({ top: boardPosition.current }));
  };

  type EditFields = { title: string; content_long?: string; summary_short: string; implications: string; image_url: string; level: string; category: string; categoryMode: "only" | "rewrite" };
  const saveEdit = async (fields: EditFields) => {
    if (!editingItem) return;
    setEditSaving(true);
    setEditError("");
    try {
      const res = await fetch("/api/admin/news/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingItem.id, title: fields.title, content_long: fields.content_long, summary_short: fields.summary_short, implications: fields.implications, image_url: fields.image_url, level: fields.level }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      const patch: Partial<NewsItem> = { ...(fields.content_long !== undefined && { content_long: fields.content_long }), title: fields.title, summary_short: fields.summary_short, implications: fields.implications, image_url: fields.image_url || null, level: fields.level as NewsItem["level"] };
      // 카테고리를 바꿨고 "카테고리만 변경"이면 이어서 저장, "다시 쓰기"면 저장 후 비교 창을 띄움
      if (fields.category !== editingItem.category && fields.categoryMode === "only") {
        const r2 = await fetch("/api/admin/news/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingItem.id, category: fields.category }) });
        const j2 = await r2.json();
        if (!r2.ok) throw new Error(j2.error ?? "카테고리 저장 실패 (제목·요약·레벨은 저장됨)");
        Object.assign(patch, { category: j2.category, category_edited: true, category_reason: null });
      }
      const id = editingItem.id;
      patchItem(id, patch);
      setEditingItem({ ...editingItem, ...patch });
      editDirty.current = false;
      setEditorRevision(value => value + 1);
      setEditNotice("저장했습니다.");
      if (fields.categoryMode === "rewrite") { rewritePreviousWide.current = editorWide; setRewriteFor({ id, target: fields.category }); }
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setEditSaving(false);
    }
  };
  // ── 대기열 일괄 처리 ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  };
  const bulkPublish = () => {
    const ids = selectedIds;
    if (ids.size === 0) return;
    setItems((prev) => prev.map((i) => ids.has(i.id) ? { ...i, is_published: true, published_at: new Date().toISOString() } : i));
    setSelectedIds(new Set());
  };
  const bulkDelete = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}건을 삭제할까요?`)) return;
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    setDeletedIds((prev) => [...prev, ...ids]);
    setSelectedIds(new Set());
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
      // 실제로 바뀐 항목만 전송 — 매번 화면에 있는 뉴스 전체를 다시 쓰면 항목 수만큼 느려짐
      const initialById = baselineRef.current;
      const changedItems = items.filter((item) => {
        const before = initialById.get(item.id);
        if (!before) return true; // 원본에 없던 항목(방금 재발행 등)은 안전하게 포함
        return before.is_published !== item.is_published
          || before.display_order !== item.display_order
          || before.level !== item.level;
      });
      const res = await fetch("/api/admin/save-curation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: changedItems, deletedIds, republishIds }),
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
        const budgetNote = json.budget_exceeded ? " · ⚠️ 시간예산 초과로 일부 소스 스킵됨" : "";
        setRunResult(`✅ 발행 ${json.published}건 / 대기 ${json.staged}건 / 스킵 ${json.skipped}건 / 실패 ${json.failed}건${budgetNote}`);
      }
      router.refresh();
    } catch (e) {
      setRunResult(`❌ ${e instanceof Error ? e.message : "오류 발생"}`);
    } finally {
      setRunning(false);
    }
  };

  // ── 카테고리 필터 ──
  const [filterCat, setFilterCat] = useTabParam<string>("cat", "ALL");
  const archiveState = archiveLists[filterCat];
  const archive = (archiveState?.ids ?? []).map((id) => itemsById.get(id)).filter((i): i is NewsItem => !!i && isArchive(i, lastRunMs));
  const activeList = tab === "live" ? liveSortedByCat : tab === "staging" ? staging : archive;
  const CATEGORIES = [...new Set([...(navCategories ?? []), ...items.map((i) => i.category)])];

  // 아카이브 "더 보기" — 서버에서 30건씩 읽어 기사 목록(items)에 합치고, 이 카테고리의 읽은 순서를 이어 붙임
  const loadArchive = async (cat: string) => {
    const cur = archiveLists[cat];
    if (cur?.loading) return;
    const offset = cur?.fetched ?? 0;
    setArchiveLists((p) => ({ ...p, [cat]: { ids: cur?.ids ?? [], fetched: offset, total: cur?.total ?? 0, loaded: !!cur?.loaded, loading: true, error: null } }));
    try {
      const qs = new URLSearchParams({ before: new Date(lastRunMs).toISOString(), cat, offset: String(offset), limit: String(ARCHIVE_PAGE) });
      const res = await fetch(`/api/admin/news/archive?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "아카이브를 불러오지 못했습니다");
      const got = json.items as NewsItem[];
      for (const g of got) if (!baselineRef.current.has(g.id)) baselineRef.current.set(g.id, g);
      setItems((prev) => { const have = new Set(prev.map((i) => i.id)); return [...prev, ...got.filter((g) => !have.has(g.id))]; });
      setArchiveLists((p) => {
        const base = p[cat];
        const ids = [...(base?.ids ?? [])]; for (const g of got) if (!ids.includes(g.id)) ids.push(g.id);
        return { ...p, [cat]: { ids, fetched: offset + got.length, total: json.total ?? 0, loaded: true, loading: false, error: null } };
      });
    } catch (e) {
      setArchiveLists((p) => ({ ...p, [cat]: { ...(p[cat] ?? { ids: [], fetched: 0, total: 0, loaded: false }), loading: false, error: e instanceof Error ? e.message : "불러오기 실패" } }));
    }
  };
  // 아카이브 탭을 열거나 카테고리를 바꾸면, 아직 안 읽은 목록의 첫 30건을 읽음
  useEffect(() => {
    if (tab !== "archive") return;
    const cur = archiveLists[filterCat];
    if (!cur || (!cur.loaded && !cur.loading && !cur.error)) void loadArchive(filterCat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterCat, archiveLists]);
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

  const handleArchiveEdition = async (disable = false) => {
    if (saving || running || archiving) return;
    if (deletedIds.length || republishIds.length || items.some(item =>
      JSON.stringify(item) !== JSON.stringify(baselineRef.current.get(item.id)))) {
      setRunResult("먼저 변경사항을 저장한 뒤 아카이빙해 주세요."); return;
    }
    setArchiving(true);
    const request = async (body: Record<string, unknown>) => {
      const response = await fetch("/api/admin/news/archive", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "아카이빙 처리에 실패했습니다.");
      return result;
    };
    try {
      if (disable) {
        if (!window.confirm("자동 발행이 안정화됐다면 임시 아카이빙 기능을 종료하세요.\n종료 후 버튼과 실행 기능이 비활성화됩니다. 다시 사용하려면 운영 설정 변경이 필요합니다.\n종료할까요?")) return;
        await request({ action: "disable" });
        setRunResult("임시 아카이빙 기능을 종료했습니다.");
      } else {
        const preview = await request({ action: "preview" });
        if (!preview.available) { setRunResult("넘길 이전 회차 기사가 없습니다. 현재 회차는 그대로 유지됩니다."); return; }
        const message = formatKSTDateTime(Date.parse(preview.cutoff)) + " (한국시간) 이전의 메인 기사 " + preview.count + "건을 아카이브로 넘깁니다.\n"
          + "해당 시각 이후 기사 " + preview.kept + "건은 메인에 남습니다. 기사는 삭제되지 않습니다.\n"
          + (preview.kept === 0 ? "새 기사를 수동 발행하기 전까지 메인 기사 목록이 비게 됩니다.\n" : "")
          + "이전 회차를 아카이빙할까요?";
        if (!window.confirm(message)) return;
        const result = await request({ action: "archive", cutoff: preview.cutoff, boundary: preview.boundary, count: preview.count });
        setRunResult("이전 회차 " + result.count + "건을 아카이브로 넘겼습니다. 새 기사를 수동 발행할 수 있습니다.");
      }
      router.refresh();
    } catch (error) { setRunResult((error as Error).message); }
    finally { setArchiving(false); }
  };

  const hasPendingChanges = deletedIds.length > 0 || republishIds.length > 0;

  const editorList = editorIds.map(id => itemsById.get(id)).filter((row): row is NewsItem => !!row);
  const selectedIndex = editorList.findIndex(row => row.id === editingItem?.id);
  const editor = editingItem ? (
      <dialog ref={editorRoot} aria-label="기사 편집" className="fixed inset-y-0 left-auto right-0 m-0 p-0 border-0 h-dvh max-h-none max-w-full backdrop:bg-black/40" style={{ width: editorWide ? "min(1200px, 100vw)" : "min(680px, 100vw)", background: "var(--surface-container-lowest)", color: "var(--on-surface)", boxShadow: "-8px 0 32px #0002" }} onCancel={event => { event.preventDefault(); closeEditor(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right) closeEditor(); } }}>
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between flex-wrap gap-3 p-4 border-b shrink-0" style={{ borderColor: "var(--surface-container-high)" }}>
          <div><h2 className="text-lg font-semibold m-0">{rewriteFor ? "기사 다시 쓰기" : "기사 편집"}</h2><p className="text-xs m-0 mt-1" style={{ color: "var(--on-surface-variant)" }}>{selectedIndex + 1} / {editorList.length} · {editingItem.category}</p></div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setEditorWide(value => !value)} className="px-3 py-2 rounded-md text-sm" style={{ background: "var(--surface-container-highest)" }}>{editorWide ? "좁게 보기" : "넓게 보기"}</button>
            <button type="button" onClick={closeEditor} disabled={editSaving} className="px-3 py-2 rounded-md text-sm disabled:opacity-50" style={{ background: "var(--surface-container-highest)" }}>닫기</button>
          </div>
        </header>
          <section className="min-w-0 min-h-0 flex-1" aria-label="기사 편집 내용">
            {rewriteFor ? <CategoryChangeDialog key={rewriteFor.id + rewriteFor.target} embedded item={editingItem} target={rewriteFor.target}
              onStateChange={handleRewriteState}
              onPatch={patch => { patchItem(editingItem.id, patch); setEditingItem(previous => previous ? { ...previous, ...patch } : previous); setEditNotice("변경 내용을 저장했습니다."); }}
              onClose={() => { setRewriteFor(null); rewriteState.current = { busy: false, dirty: false }; setEditorWide(rewritePreviousWide.current); setEditorRevision(value => value + 1); }} />
              : <EditArticlePanel key={editingItem.id + ":" + editorRevision} item={editingItem} focus={editFocus}
                categoryOptions={[...new Set([...(navCategories?.length ? navCategories : CATEGORY_OPTIONS), "EZPMP"])]}
                saving={editSaving} error={editError} notice={editNotice} onDirtyChange={value => { editDirty.current = value; }} onSave={saveEdit}
                onPrevious={selectedIndex > 0 ? () => openEdit(editorList[selectedIndex - 1]) : undefined}
                onNext={selectedIndex + 1 < editorList.length ? () => openEdit(editorList[selectedIndex + 1]) : undefined} />}
          </section>
      </div>
      </dialog>
    ) : null;

  return (
    <div>
      {/* Header (좁은 화면에서는 세로로 쌓이고 버튼이 줄바꿈됨) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0 flex items-center gap-2">큐레이션 보드 <HelpTriggerConnected /></h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            드래그로 순서를 조정하고 발행 상태를 관리합니다
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRunCuration}
            disabled={running || archiving}
            className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80 whitespace-nowrap"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {running ? "수집 중..." : "AI 큐레이션 실행"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || archiving}
            className="h-9 px-5 rounded-md text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80 whitespace-nowrap"
            style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
          >
            {saving ? "저장 중..." : hasPendingChanges ? "변경사항 저장 •" : "변경사항 저장"}
          </button>
        </div>
      </div>

      {temporaryArchiveEnabled && (
        <div className="mb-5 p-3 rounded-lg text-sm" style={{ background: "var(--surface-container-lowest)", border: "1px solid var(--surface-container-high)" }}>
          <p className="m-0 mb-2 text-xs" style={{ color: "var(--on-surface-variant)" }}>자동 발행 실패 시 수동 발행을 준비하는 임시 기능입니다. 최근 예약 시각 이전 기사만 아카이브로 넘깁니다.</p>
          <div className="flex gap-3 items-center flex-wrap">
            <button onClick={() => void handleArchiveEdition()} disabled={archiving || saving || running}
              className="px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--surface-container-highest)", border: "none", cursor: "pointer" }}>
              {archiving ? "처리 중…" : "이전 회차 아카이빙 · 임시"}
            </button>
            <button onClick={() => void handleArchiveEdition(true)} disabled={archiving || saving || running}
              className="text-xs underline disabled:opacity-50" style={{ background: "none", border: "none", color: "var(--on-surface-variant)", cursor: "pointer" }}>임시 기능 종료</button>
          </div>
        </div>
      )}

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
            onClick={() => { setTab(key); setSelectedIds(new Set()); }}
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

      {/* ── 대기열 일괄 처리 바 ── */}
      {tab === "staging" && filtered.length > 0 && (
        <div className="mb-3 flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg"
          style={{ background: "var(--surface-container-lowest)" }}>
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: "var(--on-surface-variant)" }}>
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))}
              onChange={() => toggleSelectAll(filtered.map((i) => i.id))}
              style={{ cursor: "pointer" }}
            />
            전체 선택
          </label>
          <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>
            {selectedIds.size > 0 ? `${selectedIds.size}건 선택됨` : "품질점수 높은 순 정렬"}
          </span>
          <div className="flex-1" />
          <button
            onClick={bulkPublish}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
            style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: selectedIds.size ? "pointer" : "default" }}
          >
            <Eye size={13} /> 선택 발행
          </button>
          <button
            onClick={bulkDelete}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
            style={{ background: "var(--surface-container-highest)", color: "#dc2626", border: "none", cursor: selectedIds.size ? "pointer" : "default" }}
          >
            <Trash2 size={13} /> 선택 삭제
          </button>
          <span className="text-[0.68rem]" style={{ color: "var(--on-surface-variant)", opacity: 0.7 }}>
            변경 후 <strong>변경사항 저장</strong> 클릭
          </span>
        </div>
      )}

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
                        onTogglePublish={togglePublish}
                        onMove={moveItem}
                        onRemove={remove}
                        onRepublish={republish}
                        onEdit={openEdit}
                  onMarkGood={markGood}
                  onReject={(it) => { setFitError(""); setRejectItem(it); }}
                  liked={likedIds.has(item.id)}
                  onPatch={patchItem}
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
                  onTogglePublish={togglePublish}
                  onMove={moveItem}
                  onRemove={remove}
                  onRepublish={republish}
                  onEdit={openEdit}
                  onMarkGood={markGood}
                  onReject={(it) => { setFitError(""); setRejectItem(it); }}
                  liked={likedIds.has(item.id)}
                  onPatch={patchItem}
                  LEVEL_STYLE={LEVEL_STYLE}
                  selected={tab === "staging" ? selectedIds.has(item.id) : undefined}
                  onToggleSelect={tab === "staging" ? toggleSelect : undefined}
                />
              ))
          }
          {filtered.length === 0 && <EmptyState tab={tab} />}
        </div>
      )}

      {/* ── 아카이브: 날짜별 그룹 ── */}
      {tab === "archive" && (
        <div className="flex flex-col gap-6">
          {archiveGroups.length === 0 && !archiveState?.loading && !archiveState?.error && <EmptyState tab="archive" />}
          {archiveState?.loading && archiveGroups.length === 0 && (
            <p className="text-xs m-0 flex items-center gap-2" style={{ color: "var(--on-surface-variant)" }}><Loader2 size={13} className="animate-spin" /> 아카이브를 불러오는 중…</p>
          )}
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
                      onTogglePublish={togglePublish}
                    onMove={moveItem}
                    onRemove={remove}
                    onRepublish={republish}
                    onEdit={openEdit}
                  onMarkGood={markGood}
                  onReject={(it) => { setFitError(""); setRejectItem(it); }}
                  liked={likedIds.has(item.id)}
                  onPatch={patchItem}
                    LEVEL_STYLE={LEVEL_STYLE}
                  />
                ))}
              </div>
            </div>
          ))}
          {archiveState?.error && (
            <p className="text-xs m-0" style={{ color: "#b91c1c" }}>
              {archiveState.error} <button onClick={() => void loadArchive(filterCat)} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", textDecoration: "underline", fontSize: "inherit" }}>다시 시도</button>
            </p>
          )}
          {archiveState?.loaded && (
            <div className="flex items-center justify-center gap-3 pb-2">
              <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>
                {archiveState.total}건 중 {archive.length}건 표시
              </span>
              {archiveState.ids.length < archiveState.total && (
                <button onClick={() => void loadArchive(filterCat)} disabled={archiveState.loading}
                  className="h-8 px-4 rounded-md text-xs font-semibold disabled:opacity-50 flex items-center gap-2"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>
                  {archiveState.loading && <Loader2 size={12} className="animate-spin" />}더 보기 ({ARCHIVE_PAGE}건)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {rejectItem && (
        <RejectFitModal
          item={rejectItem}
          busy={fitBusy}
          error={fitError}
          onCancel={() => { setRejectItem(null); setFitError(""); }}
          onConfirm={(reason) => void sendFitFeedback(rejectItem.id, "bad", reason)}
        />
      )}
      {editor}
    </div>
  );
}

/* ── 부적합 표시 모달 — 사유를 골라 학습 예시로 남김 ── */
const REJECT_REASONS = ["주제 무관", "너무 일반적인 소식", "홍보성·광고성", "독자 업무와 거리 멂", "특정 산업 전용"];
function RejectFitModal({ item, busy, error, onCancel, onConfirm }: {
  item: NewsItem; busy: boolean; error: string;
  onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [custom, setCustom] = useState("");
  const finalReason = reason === "직접 입력" ? custom.trim() : reason;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl p-5" style={{ background: "var(--surface-container-lowest)" }} onClick={(e) => e.stopPropagation()}>
        <p className="font-bold text-sm m-0 mb-1" style={{ color: "var(--on-surface)" }}>부적합으로 표시</p>
        <p className="text-xs m-0 mb-3 truncate" style={{ color: "var(--on-surface-variant)" }}>{item.title}</p>
        <p className="text-xs m-0 mb-2" style={{ color: "var(--on-surface-variant)" }}>
          이 기사는 삭제되고, 제목과 사유가 다음 큐레이션의 적합성 판정 예시로 들어갑니다. 같은 기사는 다시 수집되지 않습니다.
          (중복·오류라서 지우는 거라면 일반 삭제를 쓰세요 — 학습되지 않습니다)
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[...REJECT_REASONS, "직접 입력"].map((r) => (
            <button key={r} onClick={() => setReason(r)}
              className="px-2.5 py-1 rounded-full text-[0.72rem] font-semibold"
              style={{
                border: "1px solid var(--surface-container-highest)", cursor: "pointer",
                background: reason === r ? "var(--on-surface)" : "transparent",
                color: reason === r ? "var(--surface-container-lowest)" : "var(--on-surface-variant)",
              }}>{r}</button>
          ))}
        </div>
        {reason === "직접 입력" && (
          <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} placeholder="예: 대학 홍보 기사"
            className="w-full text-sm mb-3"
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--surface-container-high)", background: "var(--surface-container-low)", color: "var(--on-surface)", outline: "none" }} />
        )}
        {error && <p className="text-xs m-0 mb-2" style={{ color: "#b91c1c" }}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}>취소</button>
          <button onClick={() => onConfirm(finalReason)} disabled={busy || !finalReason}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{ background: "#dc2626", color: "#fff", border: "none", cursor: busy || !finalReason ? "default" : "pointer", opacity: busy || !finalReason ? 0.6 : 1 }}>
            {busy && <Loader2 size={12} className="animate-spin" />} 부적합으로 표시
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 목록 옆 기사 편집 패널 ── */
function EditArticlePanel({ item, focus, categoryOptions, saving, error, notice, onSave, onDirtyChange, onPrevious, onNext }: {
  item: NewsItem; focus?: "category" | "level"; categoryOptions: string[];
  saving: boolean; error: string; notice: string; onDirtyChange: (dirty: boolean) => void;
  onPrevious?: () => void; onNext?: () => void;
  onSave: (fields: { title: string; summary_short: string; content_long?: string; implications: string; image_url: string; level: string; category: string; categoryMode: "only" | "rewrite" }) => void;
}) {
  const initial = { title: item.title, summary_short: item.summary_short, content_long: "", implications: "", image_url: item.image_url ?? "", level: item.level ?? "Intermediate", category: item.category };
  const [fields, setFields] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [pane, setPane] = useState<"content" | "image" | "rewrite">("content");
  const classRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      setDetailState("loading");
      try {
        const response = await fetch("/api/admin/news/detail?id=" + encodeURIComponent(item.id), { signal: controller.signal });
        const detail = await response.json();
        if (!response.ok) throw new Error(detail.error ?? "불러오기 실패");
        if (alive) {
          const values = { title: detail.title ?? item.title, summary_short: detail.summary_short ?? item.summary_short,
            content_long: detail.content_long ?? "", implications: detail.implications ?? "", image_url: detail.image_url ?? item.image_url ?? "",
            level: detail.level ?? item.level ?? "Intermediate", category: detail.category ?? item.category };
          setFields(values); setBaseline(values); setDetailState("ready");
        }
      } catch { if (alive) setDetailState("error"); }
    })();
    return () => { alive = false; controller.abort(); };
  }, [item, reload]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(baseline);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (focus && detailState === "ready") classRef.current?.scrollIntoView({ block: "nearest" }); }, [focus, detailState]);
  const update = (key: keyof typeof fields, value: string) => setFields(previous => ({ ...previous, [key]: value }));
  const inputStyle: React.CSSProperties = { background: "var(--surface-container-lowest)", border: "1px solid var(--surface-container-high)", borderRadius: 6, color: "var(--on-surface)", padding: "9px 11px", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.7, width: "100%", boxSizing: "border-box" };
  const valid = detailState === "ready" && !!fields.title.trim() && !!fields.summary_short.trim() && (!!fields.content_long.trim() || fields.content_long === baseline.content_long);
  return <div className="flex flex-col h-full min-h-0">
    <div className="flex gap-2 flex-wrap p-4 border-b shrink-0" style={{ borderColor: "var(--surface-container-high)" }} role="tablist" aria-label="기사 편집 항목">
      {([['content', '기사 내용'], ['image', '이미지·원문'], ['rewrite', '기사 다시 쓰기']] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={pane === key} aria-controls={"edit-pane-" + item.id} disabled={saving} onClick={() => setPane(key)} className="px-3 py-2 rounded-md text-sm" style={{ background: pane === key ? "var(--primary)" : "var(--surface-container-highest)", color: pane === key ? "var(--on-primary)" : "var(--on-surface)" }}>{label}</button>)}
    </div>
    <div className="overflow-y-auto p-4 sm:p-6 flex-1" id={"edit-pane-" + item.id} role="tabpanel" aria-label={pane === 'rewrite' ? '기사 다시 쓰기' : pane === 'image' ? '이미지·원문' : '기사 내용'}>
      {detailState === "loading" && <p role="status" className="text-sm">기사 내용을 불러오는 중…</p>}
      {detailState === "error" && <div role="alert" className="text-sm mb-4">기사 내용을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></div>}
      <fieldset disabled={saving || detailState !== "ready"} className="border-0 p-0 m-0 min-w-0 flex flex-col gap-4 disabled:opacity-60">
        {pane === "content" && <>
          <label className="text-xs font-semibold">제목<textarea rows={2} className="block mt-2" value={fields.title} onChange={e => update('title', e.target.value)} style={inputStyle} /></label>
          <div ref={classRef} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs font-semibold">카테고리<select className="block mt-2" value={fields.category} onChange={e => update('category', e.target.value)} style={inputStyle}>{[...new Set([...categoryOptions, fields.category])].map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="text-xs font-semibold">레벨<select className="block mt-2" value={fields.level} onChange={e => update('level', e.target.value)} style={inputStyle}>{['Beginner','Intermediate','Advanced'].map(value => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label className="text-xs font-semibold">요약<textarea rows={3} className="block mt-2" value={fields.summary_short} onChange={e => update('summary_short', e.target.value)} style={inputStyle} /></label>
          <label className="text-xs font-semibold">본문<textarea rows={8} className="block mt-2" value={fields.content_long} onChange={e => update('content_long', e.target.value)} style={inputStyle} /></label>
          <label className="text-xs font-semibold">시사점<textarea rows={8} className="block mt-2" value={fields.implications} onChange={e => update('implications', e.target.value)} style={inputStyle} /></label>
          <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>여기서 카테고리·레벨을 바꾸면 분류 값만 저장됩니다. 글도 바꾸려면 ‘기사 다시 쓰기’를 선택하세요.</p>
        </>}
        {pane === "image" && <>
          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "16 / 9", background: "var(--surface-container-low)" }}><ArticleImg src={fields.image_url} alt="기사 대표 이미지" style={{ width: "100%", height: "100%", objectFit: "contain" }} /></div>
          <label className="text-xs font-semibold">이미지 URL<input className="block mt-2" value={fields.image_url} onChange={e => update('image_url', e.target.value)} style={inputStyle} /></label>
          <div className="text-xs">원문 주소<p className="break-all mt-2">{item.original_url}</p><a href={item.original_url} target="_blank" rel="noopener noreferrer" className="underline">원문 새 탭에서 보기</a></div>
        </>}
        {pane === "rewrite" && <>
          <h3 className="text-base font-semibold m-0">카테고리 관점으로 다시 쓰기</h3>
          <p className="text-sm m-0">현재 입력한 내용을 먼저 저장한 뒤 새 글을 만듭니다. 새 글은 지금 글과 비교하고 교체를 선택해야 적용됩니다.</p>
          <label className="text-xs font-semibold">다시 쓸 카테고리<select className="block mt-2" value={fields.category} onChange={e => update('category', e.target.value)} style={inputStyle}>{[...new Set([...categoryOptions, fields.category])].map(value => <option key={value}>{value}</option>)}</select></label>
          <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>다음 화면에서 글 수준을 유지하거나 변경할 수 있습니다. 원문을 확보하지 못한 기사는 카테고리만 변경할 수 있습니다.</p>
        </>}
      </fieldset>
    </div>
    <footer className="p-4 border-t shrink-0 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: "var(--surface-container-high)", background: "var(--surface-container-lowest)" }}>
      <span role={error ? "alert" : "status"} className="text-xs" style={{ color: error ? "#b91c1c" : "var(--on-surface-variant)" }}>{error || (dirty ? "저장하지 않은 변경사항" : notice || "수정사항 없음")}</span>
      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={saving || !onPrevious} onClick={onPrevious} className="px-3 py-2 rounded text-sm disabled:opacity-40" style={{ background: "var(--surface-container-highest)" }}>이전</button>
        <button type="button" disabled={saving || !onNext} onClick={onNext} className="px-3 py-2 rounded text-sm disabled:opacity-40" style={{ background: "var(--surface-container-highest)" }}>다음</button>
        <button type="button" disabled={saving || !valid} onClick={() => onSave({ ...fields, content_long: fields.content_long === baseline.content_long ? undefined : fields.content_long, categoryMode: pane === "rewrite" ? "rewrite" : "only" })} className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-40" style={{ background: "var(--primary)", color: "var(--on-primary)" }}>{saving ? "저장 중…" : pane === "rewrite" ? "저장 후 다시 쓰기" : "저장"}</button>
      </div>
    </footer>
  </div>;
}

/* ── 카드 컴포넌트 ── */
function ArticleCard({
  item, idx, tab, qualityThresholds, isTopNews,
  onDragStart, onDragEnter, onDragEnd,
  onTogglePublish, onMove, onRemove, onRepublish, onEdit, onMarkGood, onReject, liked,
  LEVEL_STYLE, selected, onToggleSelect,
}: {
  onMarkGood: (item: NewsItem) => void;
  onReject: (item: NewsItem) => void;
  liked: boolean;
  item: NewsItem;
  idx: number;
  tab: Tab;
  qualityThresholds: { auto_publish: number; staging: number };
  isTopNews: boolean;
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDragEnd: () => void;
  onTogglePublish: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onRepublish: (id: string) => void;
  onEdit: (item: NewsItem, focus?: "category" | "level") => void;
  onPatch: (id: string, patch: Partial<NewsItem>) => void;
  LEVEL_STYLE: Record<string, { bg: string; color: string }>;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [observedAt] = useState(() => Date.now());
  const isDraggable = tab === "live";

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? () => onDragStart(idx) : undefined}
      onDragEnter={isDraggable ? () => onDragEnter(idx) : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onDragOver={isDraggable ? (e) => e.preventDefault() : undefined}
      className="flex flex-wrap items-start gap-3 p-4 rounded-lg transition-shadow"
      style={{
        background: isTopNews ? "rgba(var(--primary-rgb, 26,115,232),0.04)" : "var(--surface-container-lowest)",
        boxShadow: isTopNews ? "0 0 0 1.5px var(--primary)" : "0 1px 3px rgba(26,28,29,0.04)",
        cursor: isDraggable ? "grab" : "default",
      }}
    >
      {/* 대기열 선택 체크박스 (staging 탭에서만) */}
      {onToggleSelect ? (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(item.id)}
          className="mt-1 flex-shrink-0"
          style={{ cursor: "pointer", width: 16, height: 16 }}
        />
      ) : (
        /* drag handle */
        <GripVertical
          size={16}
          className="mt-1 flex-shrink-0"
          style={{ color: isDraggable ? "var(--on-surface-variant)" : "transparent" }}
        />
      )}

      {/* content */}
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {isTopNews && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              <TrendingUp size={9} /> TOP
            </span>
          )}
          <CategoryEditor item={item} onOpen={() => onEdit(item, "category")} />
          <button
            title="클릭하면 기사 편집 창이 열립니다 (레벨은 값만 바뀌고 글은 다시 쓰이지 않습니다. 저장하면 AI 레벨 판정의 참고 사례로 쌓입니다.)"
            onClick={() => onEdit(item, "level")}
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
                ? `관련성 ${item.quality_criteria.relevance} · 구체성 ${item.quality_criteria.specificity} · 실용성 ${item.quality_criteria.practicality} · 원문품질 ${item.quality_criteria.source_quality}${item.quality_criteria.fit != null ? ` · 회사적합성 ${item.quality_criteria.fit}` : ""}\n자동발행 기준: ${qualityThresholds.auto_publish}점 / 대기열 기준: ${qualityThresholds.staging}점`
                : `자동발행 기준: ${qualityThresholds.auto_publish}점 / 대기열 기준: ${qualityThresholds.staging}점`}
            >
              ★ {item.quality_score}
            </span>
          )}
          {tab === "staging" && item.quality_criteria?.fit != null && (
            <span className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide"
              title={item.fit_reason ? `AI 판정 근거: ${item.fit_reason}\n(7점 이상 자동 발행 / 5~6점 대기열 / 4점 이하 폐기)` : "회사(MICE·관광) 적합성 — 낮을수록 우리 관심사와 거리가 멂"}
              style={{
                background: item.quality_criteria.fit >= 7 ? "rgba(22,163,74,0.15)" : "rgba(220,38,38,0.12)",
                color: item.quality_criteria.fit >= 7 ? "#16a34a" : "#dc2626",
              }}>
              적합 {item.quality_criteria.fit}
            </span>
          )}
          {tab === "staging" && item.created_at &&
            observedAt - new Date(item.created_at).getTime() < 48 * 60 * 60 * 1000 && (
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
      <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
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

        <button title="편집 (제목·요약·시사점·이미지·카테고리·레벨)" onClick={() => onEdit(item)}
          className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          <Pencil size={14} style={{ color: "var(--on-surface-variant)" }} />
        </button>

        {item.category !== "EZPMP" && (
          <>
            <button title={liked ? "좋은 기사로 학습됨" : "좋은 기사 — 이런 기사를 더 뽑도록 학습"} onClick={() => onMarkGood(item)}
              className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
              style={{ background: liked ? "rgba(22,163,74,0.12)" : "transparent", border: "none", cursor: liked ? "default" : "pointer" }}>
              <ThumbsUp size={14} style={{ color: liked ? "#16a34a" : "var(--on-surface-variant)" }} />
            </button>
            <button title="부적합 — 사유와 함께 학습하고 삭제 (다시 수집 안 됨)" onClick={() => onReject(item)}
              className="p-1.5 rounded hover:bg-[--surface-container-high] transition-colors"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <ThumbsDown size={14} style={{ color: "var(--on-surface-variant)" }} />
            </button>
          </>
        )}

        <button title="삭제 (중복·오류용 — 학습되지 않음)" onClick={() => onRemove(item.id)}
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
