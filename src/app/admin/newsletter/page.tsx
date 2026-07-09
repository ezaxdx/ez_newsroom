"use client";

import React, { useState, useEffect, useRef } from "react";
import { Trash2, ToggleLeft, ToggleRight, Plus, Loader2, Sparkles, CheckCircle, XCircle, ExternalLink, Download } from "lucide-react";

type Subscriber = {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
};

type Issue = {
  id: string;
  vol_number: number;
  editorial_text: string | null;
  status: "draft" | "sending" | "sent" | "partial" | "failed" | string;
  total_sent: number;
  total_failed: number;
  target_count: number | null;
  html_content: string | null;
  sent_at: string | null;
  created_at: string;
};

type SendLog = { id: string; email: string; status: string; error_message: string | null; sent_at: string };
type EventForImage = { id: string; event_name: string; start_date: string; end_date: string | null; venue: string | null; image_url: string | null; website: string | null; is_published: boolean };
type CronSettings = { enabled: boolean; send_days: number[]; send_hour: number; default_editorial: string | null };

type Tab = "send" | "subscribers" | "history" | "manual" | "gmail";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default function NewsletterPage() {
  const [tab, setTab] = useState<Tab>("send");

  // ── Send tab state ──
  const [editorialText, setEditorialText] = useState("");
  const [skipEzpmp, setSkipEzpmp] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ vol_number: number; send_date: string; featured_ids: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendElapsed, setSendElapsed] = useState(0);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sendProgress, setSendProgress] = useState<{ totalSent: number; targetCount: number; remainingCount: number; round: number } | null>(null);
  const [activeCount, setActiveCount] = useState<number | null>(null);

  // ── Subscribers tab state ──
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [addingSubscriber, setAddingSubscriber] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  // ── History tab state ──
  const [issues, setIssues] = useState<Issue[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── 이력 탭 - 실패 로그 ──
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [issueLogs, setIssueLogs] = useState<SendLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // ── 수신자 탭 - 선택 삭제 ──
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeactivating, setBulkDeactivating] = useState(false);
  const [bulkActivating, setBulkActivating] = useState(false);

  // ── 수신자 탭 - 엑셀 업로드 ──
  const excelFileRef = useRef<HTMLInputElement>(null);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelResult, setExcelResult] = useState<{ inserted: number; skipped: number; duplicates: string[] } | null>(null);

  // ── AI 인사말 생성 ──
  const [generatingEditorial, setGeneratingEditorial] = useState(false);
  const [editorialError, setEditorialError] = useState<string | null>(null);
  // 이번 호 콘텐츠 context (뉴스 제목 + 행사명) - 마운트 시 백그라운드 프리페치
  const [editorialCtx, setEditorialCtx] = useState<{ news_titles: string[]; event_names: string[] } | null>(null);

  // ── 자동 발송 설정 ──
  const [cronSettings, setCronSettings] = useState<CronSettings>({ enabled: false, send_days: [2, 4], send_hour: 10, default_editorial: "" });
  const [cronSaving, setCronSaving] = useState(false);
  const [cronSaved, setCronSaved] = useState(false);
  const [cronOpen, setCronOpen] = useState(false);

  // ── Gmail 연동 상태 ──
  const [gmailStatus, setGmailStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [gmailUpdatedAt, setGmailUpdatedAt] = useState<string | null>(null);

  // ── 행사 이미지 관리 ──
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [imageEvents, setImageEvents] = useState<EventForImage[]>([]);
  const [imageEventsLoading, setImageEventsLoading] = useState(false);
  const [imageEdits, setImageEdits] = useState<Record<string, string>>({}); // id → url 편집값
  const [imageSaving, setImageSaving] = useState<Set<string>>(new Set());
  const [imageSaved, setImageSaved] = useState<Set<string>>(new Set());
  const [imageAutoFetching, setImageAutoFetching] = useState<Set<string>>(new Set());

  // ── 이력 로그 모드 ──
  const [logMode, setLogMode] = useState<"all" | "failed">("all");

  // ── 미수신자 조회 + 재발송 ──
  type UnsentEntry = { id: string; email: string; name: string | null; error_message: string | null };
  const [unsentPanel, setUnsentPanel]   = useState<string | null>(null);
  const [unsentMap,   setUnsentMap]     = useState<Record<string, UnsentEntry[]>>({});
  const [unsentLoading, setUnsentLoading] = useState<string | null>(null);
  const [checkedEmails, setCheckedEmails] = useState<Record<string, Set<string>>>({});
  const [resendingId,   setResendingId]   = useState<string | null>(null);
  const [resendResult,  setResendResult]  = useState<Record<string, string>>({});
  const [deactivating,  setDeactivating]  = useState<string | null>(null); // subscriber id
  const [recoveringId,  setRecoveringId]  = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load active count and subscribers on mount
  useEffect(() => {
    fetchSubscribers();
    fetchCronSettings();
    fetchGmailStatus();
    prefetchEditorialContext();
  }, []);

  useEffect(() => {
    if (tab === "history") fetchHistory();
  }, [tab]);

  async function fetchSubscribers() {
    setSubLoading(true);
    try {
      const res = await fetch("/api/admin/newsletter/subscribers");
      const json = await res.json();
      const subs: Subscriber[] = json.data ?? [];
      setSubscribers(subs);
      setActiveCount(subs.filter((s) => s.is_active).length);
    } catch {
      setSubError("수신자 목록을 불러오지 못했습니다.");
    } finally {
      setSubLoading(false);
    }
  }

  async function fetchHistory() {
    setHistoryLoading(true);
    try {
      const supaRes = await fetch("/api/admin/newsletter/history");
      if (supaRes.ok) {
        const json = await supaRes.json();
        setIssues(json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }

  async function fetchGmailStatus() {
    try {
      const res = await fetch("/api/gmail/status");
      const data = await res.json();
      setGmailStatus(data.connected ? "connected" : "disconnected");
      setGmailUpdatedAt(data.updated_at ?? null);
    } catch {
      setGmailStatus("disconnected");
    }
  }

  async function fetchCronSettings() {
    try {
      const res = await fetch("/api/admin/newsletter/cron-settings");
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          // send_days 배열 우선, 없으면 send_day 단일값 fallback
          const rawDays = json.data.send_days;
          const send_days: number[] = Array.isArray(rawDays) && rawDays.length > 0
            ? rawDays
            : [json.data.send_day ?? 2];
          setCronSettings({
            enabled: json.data.enabled ?? false,
            send_days,
            send_hour: json.data.send_hour ?? 10,
            default_editorial: json.data.default_editorial ?? "",
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // 이번 호 콘텐츠(뉴스 제목 + 행사명)를 미리 가져와 state에 저장
  async function prefetchEditorialContext() {
    try {
      const res = await fetch("/api/admin/newsletter/content");
      if (!res.ok) return;
      const json = await res.json();
      const allNews = [
        ...(json.mice_news ?? []),
        ...(json.tourism_news ?? []),
        ...(json.ezpmp_news ?? []),
        ...(json.ai_news ?? []),
      ] as Array<{ title: string }>;
      const newsTitles = allNews.map((n) => n.title).filter(Boolean);
      const eventNames = (json.featured_events ?? []).map((e: { name: string }) => e.name).filter(Boolean);
      setEditorialCtx({ news_titles: newsTitles, event_names: eventNames });
    } catch {
      // 실패해도 fallback(DB 직접 조회)으로 진행됨
    }
  }

  async function handleGenerateEditorial() {
    setGeneratingEditorial(true);
    setEditorialError(null);
    try {
      const res = await fetch("/api/admin/newsletter/generate-editorial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: editorialCtx ?? undefined }),
      });
      const json = await res.json();
      if (res.ok && json.editorial) {
        setEditorialText(json.editorial);
      } else {
        setEditorialError(json.error ?? "AI 생성 실패");
      }
    } catch {
      setEditorialError("네트워크 오류");
    } finally {
      setGeneratingEditorial(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewHtml(null);
    setSendResult(null);
    try {
      const res = await fetch("/api/admin/newsletter/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editorial_text: editorialText, dry_run: true, skip_ezpmp: skipEzpmp }),
      });
      const json = await res.json();
      if (res.ok && json.html) {
        setPreviewHtml(json.html);
        setPreviewMeta({ vol_number: json.vol_number, send_date: json.send_date, featured_ids: json.featured_ids ?? [] });
      } else {
        setSendResult({ ok: false, message: json.error ?? "미리보기 실패" });
      }
    } catch {
      setSendResult({ ok: false, message: "네트워크 오류" });
    } finally {
      setPreviewing(false);
    }
  }

  const BATCH_SIZE = 50;

  async function handleSend() {
    if (!activeCount) {
      setSendResult({ ok: false, message: activeCount === null ? "수신자 수를 불러오는 중입니다. 잠시 후 다시 시도하세요." : "활성 수신자가 없습니다." });
      return;
    }
    // 첫 발송만 confirm
    if (!sendProgress) {
      const totalBatches = Math.ceil(activeCount / BATCH_SIZE);
      const confirmed = window.confirm(
        `${activeCount}명에게 ${BATCH_SIZE}명씩 총 ${totalBatches}회 발송합니다.\n지금 1/${totalBatches}회차를 시작합니다.`
      );
      if (!confirmed) return;
    }

    setSending(true);
    setSendElapsed(0);
    setSendResult(null);
    sendTimerRef.current = setInterval(() => setSendElapsed(s => s + 1), 1000);
    try {
      const res = await fetch("/api/admin/newsletter/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editorial_text: editorialText,
          dry_run: false,
          skip_ezpmp: skipEzpmp,
          ...(previewHtml && previewMeta ? {
            cached_html: previewHtml,
            cached_vol: previewMeta.vol_number,
            cached_send_date: previewMeta.send_date,
            cached_featured_ids: previewMeta.featured_ids,
          } : {}),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        const thisBatchSent = json.this_batch_sent ?? json.total_sent ?? 0;
        const newTotalSent = json.total_sent ?? 0;
        const targetCount = json.target_count ?? activeCount ?? 0;
        const remainingCount = json.remaining_count ?? 0;
        const round = (sendProgress?.round ?? 0) + 1;
        setSendProgress({ totalSent: newTotalSent, targetCount, remainingCount, round });
        const isDone = remainingCount === 0;
        setSendResult({
          ok: true,
          message: isDone && thisBatchSent === 0
            ? `✅ Vol.${json.vol_number} 이미 전체 발송 완료된 호입니다.`
            : isDone
            ? `✅ Vol.${json.vol_number} 발송 완료 (${thisBatchSent}명)`
            : `${round}회차 완료 (${thisBatchSent}명 발송, 잔여 ${remainingCount}명). 버튼을 눌러 다음 회차를 발송하세요.`,
        });
      } else {
        setSendResult({ ok: false, message: json.error ?? "발송 실패" });
      }
    } catch {
      setSendResult({ ok: false, message: "네트워크 오류" });
    } finally {
      if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
      setSending(false);
    }
  }

  async function handleAddSubscriber(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddingSubscriber(true);
    setSubError(null);
    try {
      const res = await fetch("/api/admin/newsletter/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), name: newName.trim() || undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        setNewEmail("");
        setNewName("");
        await fetchSubscribers();
      } else {
        setSubError(json.error ?? "추가 실패");
      }
    } catch {
      setSubError("네트워크 오류");
    } finally {
      setAddingSubscriber(false);
    }
  }

  async function handleToggle(sub: Subscriber) {
    try {
      const res = await fetch(`/api/admin/newsletter/subscribers/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !sub.is_active }),
      });
      if (res.ok) {
        setSubscribers((prev) =>
          prev.map((s) => (s.id === sub.id ? { ...s, is_active: !s.is_active } : s))
        );
        setActiveCount((prev) =>
          prev !== null ? prev + (sub.is_active ? -1 : 1) : null
        );
      }
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("이 수신자를 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/admin/newsletter/subscribers/${id}`, { method: "DELETE" });
      if (res.ok) {
        const deleted = subscribers.find((s) => s.id === id);
        setSubscribers((prev) => prev.filter((s) => s.id !== id));
        setSelectedSubIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
        if (deleted?.is_active) {
          setActiveCount((prev) => (prev !== null ? prev - 1 : null));
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleBulkActivate() {
    if (selectedSubIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedSubIds.size}명을 활성화하시겠습니까?`)) return;
    setBulkActivating(true);
    try {
      const ids = Array.from(selectedSubIds);
      await Promise.all(ids.map((id) => fetch(`/api/admin/newsletter/subscribers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      })));
      setSubscribers((prev) => prev.map((s) => ids.includes(s.id) ? { ...s, is_active: true } : s));
      setActiveCount((prev) => prev !== null ? prev + ids.filter(id => !subscribers.find(s => s.id === id)?.is_active).length : null);
      setSelectedSubIds(new Set());
    } catch {
      // ignore
    } finally {
      setBulkActivating(false);
    }
  }

  async function handleBulkDeactivate() {
    if (selectedSubIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedSubIds.size}명을 비활성화하시겠습니까?`)) return;
    setBulkDeactivating(true);
    try {
      const ids = Array.from(selectedSubIds);
      await Promise.all(ids.map((id) => fetch(`/api/admin/newsletter/subscribers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      })));
      setSubscribers((prev) => prev.map((s) => ids.includes(s.id) ? { ...s, is_active: false } : s));
      setActiveCount((prev) => prev !== null ? prev - ids.filter(id => subscribers.find(s => s.id === id)?.is_active).length : null);
      setSelectedSubIds(new Set());
    } catch {
      // ignore
    } finally {
      setBulkDeactivating(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedSubIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedSubIds.size}명을 삭제하시겠습니까?`)) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedSubIds);
      await Promise.all(ids.map((id) => fetch(`/api/admin/newsletter/subscribers/${id}`, { method: "DELETE" })));
      const deletedActive = subscribers.filter((s) => ids.includes(s.id) && s.is_active).length;
      setSubscribers((prev) => prev.filter((s) => !ids.includes(s.id)));
      setActiveCount((prev) => (prev !== null ? prev - deletedActive : null));
      setSelectedSubIds(new Set());
    } catch {
      // ignore
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelUploading(true);
    setExcelResult(null);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: "" });
      const subs = rows.map(r => ({
        email: String(r["email"] ?? r["이메일"] ?? "").trim().toLowerCase(),
        name: String(r["name"] ?? r["이름"] ?? "").trim() || undefined,
      })).filter(s => s.email.includes("@")); // @ 없는 행은 무시
      const res = await fetch("/api/admin/newsletter/subscribers/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribers: subs }),
      });
      const json = await res.json();
      if (res.ok) {
        setExcelResult({ inserted: json.inserted, skipped: json.skipped, duplicates: json.duplicates ?? [] });
        await fetchSubscribers();
      } else {
        setSubError(json.error ?? "업로드 실패");
      }
    } catch {
      setSubError("파일 파싱 오류");
    } finally {
      setExcelUploading(false);
      e.target.value = "";
    }
  }

  async function autoFetchOgImage(ev: EventForImage) {
    setImageAutoFetching((prev) => new Set(prev).add(ev.id));
    try {
      // 네이버 이미지 검색 우선 + og:image fallback
      const params = new URLSearchParams({ query: ev.event_name });
      if (ev.website) params.set("url", ev.website);
      const res = await fetch(`/api/og-image?${params.toString()}`);
      const data = await res.json();
      if (data.image && !data.image.includes("ez-fallback")) {
        setImageEdits((prev) => ({ ...prev, [ev.id]: data.image }));
      } else {
        alert("이미지를 찾지 못했어요. 직접 URL을 입력해주세요.");
      }
    } catch {
      alert("이미지 자동 수집 실패");
    } finally {
      setImageAutoFetching((prev) => { const s = new Set(prev); s.delete(ev.id); return s; });
    }
  }

  async function fetchIssueLogs(issue: Issue, mode: "all" | "failed") {
    // 이미 같은 이슈 + 같은 모드면 닫기
    if (selectedIssue?.id === issue.id && logMode === mode) {
      setSelectedIssue(null);
      setIssueLogs([]);
      return;
    }
    setSelectedIssue(issue);
    setLogMode(mode);
    setLogsLoading(true);
    try {
      const url = mode === "failed"
        ? `/api/admin/newsletter/logs?issue_id=${issue.id}&status=failed`
        : `/api/admin/newsletter/logs?issue_id=${issue.id}`;
      const res = await fetch(url);
      const json = await res.json();
      setIssueLogs(json.data ?? []);
    } catch {
      setIssueLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  // 미수신자 패널 토글 + 조회
  async function toggleUnsentPanel(issue: Issue) {
    if (unsentPanel === issue.id) { setUnsentPanel(null); return; }
    setUnsentPanel(issue.id);
    if (unsentMap[issue.id]) return; // 이미 로드됨
    setUnsentLoading(issue.id);
    try {
      const res = await fetch(`/api/admin/newsletter/resend?issue_id=${issue.id}`);
      const json = await res.json();
      if (res.ok) {
        setUnsentMap(prev => ({ ...prev, [issue.id]: json.unsent ?? [] }));
        // 기본으로 전체 체크
        setCheckedEmails(prev => ({
          ...prev,
          [issue.id]: new Set((json.unsent ?? []).map((u: { email: string }) => u.email)),
        }));
      }
    } catch { /* ignore */ }
    finally { setUnsentLoading(null); }
  }

  function toggleCheck(issueId: string, email: string) {
    setCheckedEmails(prev => {
      const s = new Set(prev[issueId] ?? []);
      s.has(email) ? s.delete(email) : s.add(email);
      return { ...prev, [issueId]: s };
    });
  }

  function toggleAllCheck(issueId: string, allEmails: string[]) {
    setCheckedEmails(prev => {
      const s = prev[issueId] ?? new Set<string>();
      const allChecked = allEmails.every(e => s.has(e));
      return { ...prev, [issueId]: allChecked ? new Set() : new Set(allEmails) };
    });
  }

  async function handleDeactivate(issueId: string, subscriberId: string, email: string) {
    if (!window.confirm(`${email} 구독자를 비활성화합니다. 계속하시겠습니까?`)) return;
    setDeactivating(subscriberId);
    try {
      const res = await fetch(`/api/admin/newsletter/subscribers/${subscriberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      if (res.ok) {
        setUnsentMap(prev => ({
          ...prev,
          [issueId]: (prev[issueId] ?? []).filter(u => u.id !== subscriberId),
        }));
        setCheckedEmails(prev => {
          const s = new Set(prev[issueId] ?? []);
          s.delete(email);
          return { ...prev, [issueId]: s };
        });
      }
    } catch { /* ignore */ }
    finally { setDeactivating(null); }
  }

  async function handleResend(issue: Issue) {
    const emails = Array.from(checkedEmails[issue.id] ?? []);
    if (emails.length === 0) { alert("발송할 수신자를 선택해주세요."); return; }
    const confirmed = window.confirm(`Vol.${issue.vol_number} — 선택한 ${emails.length}명에게 재발송합니다.\n계속하시겠습니까?`);
    if (!confirmed) return;

    setResendingId(issue.id);
    setResendResult(prev => ({ ...prev, [issue.id]: "" }));
    try {
      const res = await fetch("/api/admin/newsletter/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_id: issue.id, emails }),
      });
      const json = await res.json();
      if (res.ok) {
        setResendResult(prev => ({
          ...prev,
          [issue.id]: `✅ 재발송 시작 (${json.target_count}명). 잠시 후 이력을 새로고침하세요.`,
        }));
        // 패널 데이터 갱신
        setUnsentMap(prev => { const n = { ...prev }; delete n[issue.id]; return n; });
        setCheckedEmails(prev => { const n = { ...prev }; delete n[issue.id]; return n; });
        await fetchHistory();
      } else {
        setResendResult(prev => ({ ...prev, [issue.id]: `❌ ${json.error ?? "재발송 실패"}` }));
      }
    } catch {
      setResendResult(prev => ({ ...prev, [issue.id]: "❌ 네트워크 오류" }));
    } finally {
      setResendingId(null);
    }
  }

  async function handleRecoverStatus(issue: Issue) {
    if (!window.confirm(`Vol.${issue.vol_number} — 실제 발송 로그 기준으로 상태를 복구합니다. 계속하시겠습니까?`)) return;
    setRecoveringId(issue.id);
    try {
      const res = await fetch("/api/admin/newsletter/recover-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_id: issue.id }),
      });
      const json = await res.json();
      if (res.ok) {
        await fetchHistory();
      } else {
        alert(json.error ?? "복구 실패");
      }
    } catch {
      alert("네트워크 오류");
    } finally {
      setRecoveringId(null);
    }
  }

  async function fetchImageEvents() {
    setImageEventsLoading(true);
    try {
      // KST 기준 오늘 날짜
      const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
      const ninetyDays = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      // 최근 2호 featured_event_ids 조회 (이미 발송된 행사 제외용)
      const [eventsRes, historyRes] = await Promise.all([
        fetch(`/api/admin/events?from=${todayKST}&to=${ninetyDays}`),
        fetch("/api/admin/newsletter/history"),
      ]);
      const eventsJson = await eventsRes.json();
      const historyJson = await historyRes.json();

      const sentIssues: Array<{ status: string; featured_event_ids: string[] | null }> =
        (historyJson.data ?? []).filter((i: { status: string }) =>
          i.status === "sent" || i.status === "partial"
        );
      const recentlyFeatured = new Set<string>(
        sentIssues.flatMap(i => i.featured_event_ids ?? [])
      );

      const events: EventForImage[] = (eventsJson.data ?? [])
        .filter((e: EventForImage) => e.is_published && !recentlyFeatured.has(e.id));

      setImageEvents(events);
      const edits: Record<string, string> = {};
      for (const e of events) edits[e.id] = e.image_url ?? "";
      setImageEdits(edits);
    } catch {
      // ignore
    } finally {
      setImageEventsLoading(false);
    }
  }

  async function saveImageUrl(id: string) {
    setImageSaving((prev) => new Set(prev).add(id));
    setImageSaved((prev) => { const s = new Set(prev); s.delete(id); return s; });
    try {
      await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, image_url: imageEdits[id] || null }),
      });
      setImageEvents((prev) => prev.map((e) => e.id === id ? { ...e, image_url: imageEdits[id] || null } : e));
      setImageSaved((prev) => new Set(prev).add(id));
      setTimeout(() => setImageSaved((prev) => { const s = new Set(prev); s.delete(id); return s; }), 2000);
    } finally {
      setImageSaving((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function handleSaveCronSettings() {
    setCronSaving(true);
    setCronSaved(false);
    try {
      const res = await fetch("/api/admin/newsletter/cron-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cronSettings.enabled,
          send_days: cronSettings.send_days,
          send_hour: cronSettings.send_hour,
          default_editorial: cronSettings.default_editorial || null,
        }),
      });
      if (res.ok) {
        setCronSaved(true);
        setTimeout(() => setCronSaved(false), 2000);
      } else {
        const json = await res.json().catch(() => ({}));
        alert(`설정 저장 실패: ${json.error ?? res.status}`);
      }
    } catch {
      alert("설정 저장 중 네트워크 오류가 발생했습니다.");
    } finally {
      setCronSaving(false);
    }
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "8px 20px",
    borderRadius: "6px 6px 0 0",
    border: "none",
    cursor: "pointer",
    fontWeight: tab === t ? 700 : 400,
    fontSize: "14px",
    background: tab === t ? "var(--surface-container)" : "transparent",
    color: tab === t ? "var(--on-surface)" : "var(--on-surface-variant)",
    borderBottom: tab === t ? "2px solid var(--primary)" : "2px solid transparent",
    transition: "all 0.15s",
  });

  const cardStyle: React.CSSProperties = {
    background: "var(--surface-container)",
    borderRadius: "10px",
    padding: "20px",
    marginBottom: "16px",
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900 }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: 24 }}>
        ✉️ 뉴스레터 관리
      </h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 0, borderBottom: "1px solid var(--surface-container-highest)" }}>
        <button style={tabStyle("send")} onClick={() => setTab("send")}>발송</button>
        <button style={tabStyle("subscribers")} onClick={() => setTab("subscribers")}>수신자</button>
        <button style={tabStyle("history")} onClick={() => setTab("history")}>이력</button>
        <button style={tabStyle("manual")} onClick={() => setTab("manual")}>📋 매뉴얼</button>
        <button
          style={tabStyle("gmail")}
          onClick={() => { setTab("gmail"); if (gmailStatus === "loading") fetchGmailStatus(); }}
        >
          📧 Gmail 연동
          {gmailStatus === "disconnected" && (
            <span style={{ marginLeft: 5, display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#c62828", verticalAlign: "middle" }} />
          )}
        </button>
      </div>

      <div style={{ paddingTop: 20 }}>
        {/* ── SEND TAB ── */}
        {tab === "send" && (
          <div>
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)" }}>
                  에디터 인사말
                </label>
                <button
                  onClick={handleGenerateEditorial}
                  disabled={generatingEditorial}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 6,
                    border: "1px solid #6366f1",
                    background: generatingEditorial ? "var(--surface-container)" : "#ede9fe",
                    color: "#6366f1", fontWeight: 600, fontSize: 12,
                    cursor: generatingEditorial ? "not-allowed" : "pointer",
                    opacity: generatingEditorial ? 0.7 : 1, transition: "all 0.15s",
                  }}
                >
                  {generatingEditorial
                    ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                    : <Sparkles size={12} />}
                  {generatingEditorial ? "생성 중..." : "AI로 작성"}
                </button>
              </div>
              {editorialError && (
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#c0392b" }}>{editorialError}</p>
              )}
              <textarea
                value={editorialText}
                onChange={(e) => setEditorialText(e.target.value)}
                placeholder="이번 호 에디터 인사말을 입력하거나 AI로 생성하세요..."
                rows={5}
                style={{
                  width: "100%",
                  resize: "vertical",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--surface-container-highest)",
                  background: "var(--surface-container-low)",
                  color: "var(--on-surface)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  boxSizing: "border-box",
                }}
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 13, cursor: "pointer", userSelect: "none", width: "fit-content" }}>
              <input
                type="checkbox"
                checked={skipEzpmp}
                onChange={e => { setSkipEzpmp(e.target.checked); setPreviewHtml(null); }}
              />
              <span style={{ color: skipEzpmp ? "#dc2626" : "var(--on-surface-variant)" }}>
                EZPMP 섹션 제외 {skipEzpmp ? "✓" : ""}
              </span>
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
              <button
                onClick={handlePreview}
                disabled={previewing}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 18px", borderRadius: 6, border: "1px solid var(--primary)",
                  background: "transparent", color: "var(--primary)", fontWeight: 600,
                  fontSize: 14, cursor: previewing ? "not-allowed" : "pointer",
                  opacity: previewing ? 0.6 : 1,
                }}
              >
                {previewing && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                미리보기
              </button>

              {previewHtml && (
                <button
                  onClick={async () => {
                    const prodUrl = "https://ez-newsroom.vercel.app";
                    const fixed = previewHtml.replace(/https?:\/\/localhost:\d+/g, prodUrl);
                    const blob = new Blob([fixed], { type: "text/html;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `ez-letter-vol${previewMeta?.vol_number ?? ""}.html`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    // Vol 번호 + 발송일 DB 기록
                    if (previewMeta?.vol_number && previewMeta?.send_date) {
                      await fetch("/api/admin/newsletter/record-download", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          vol_number: previewMeta.vol_number,
                          send_date: previewMeta.send_date,
                          editorial_text: editorialText,
                        }),
                      });
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 18px", borderRadius: 6,
                    border: "1px solid var(--on-surface-variant)",
                    background: "transparent", color: "var(--on-surface-variant)", fontWeight: 600,
                    fontSize: 14, cursor: "pointer",
                  }}
                >
                  <Download size={14} />
                  HTML 다운로드
                </button>
              )}

              {(() => {
                const isDone = sendProgress && sendProgress.remainingCount === 0;
                const round = sendProgress?.round ?? 0;
                const label = isDone
                  ? "발송 완료"
                  : sendProgress
                    ? `발송 (${round + 1}회차)`
                    : "발송 (1회차)";
                return (
                  <button
                    onClick={handleSend}
                    disabled={sending || !!isDone}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 18px", borderRadius: 6, border: "none",
                      background: isDone ? "#16a34a" : "var(--primary)",
                      color: "#fff", fontWeight: 600,
                      fontSize: 14, cursor: (sending || isDone) ? "not-allowed" : "pointer",
                      opacity: (sending || isDone) ? 0.7 : 1,
                    }}
                  >
                    {sending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                    {label}
                  </button>
                );
              })()}

              {activeCount !== null && (
                <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>
                  현재 활성 수신자: <strong>{activeCount}명</strong>
                </span>
              )}
            </div>

            {sending && (
              <div style={{
                padding: "10px 14px", borderRadius: 6, marginBottom: 16,
                background: "#D1ECF1", color: "#0c5460",
                fontSize: 13, fontWeight: 500,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                <span>
                  발송 중... {sendElapsed}초 경과
                  {activeCount && activeCount > 0 && (
                    <span style={{ marginLeft: 6, fontWeight: 400, color: "#0c5460", opacity: 0.8 }}>
                      (예상 소요: {Math.ceil(activeCount * 0.4)}초)
                    </span>
                  )}
                  <span style={{ display: "block", fontSize: 11, marginTop: 2, fontWeight: 400 }}>
                    창을 닫지 마세요. 발송이 완료되면 자동으로 결과가 표시됩니다.
                  </span>
                </span>
              </div>
            )}

            {sendResult && (
              <div style={{
                padding: "10px 14px", borderRadius: 6, marginBottom: 16,
                background: sendResult.ok ? "#D4EDDA" : "#F8D7DA",
                color: sendResult.ok ? "#155724" : "#721C24",
                fontSize: 13, fontWeight: 500,
              }}>
                {sendResult.message}
              </div>
            )}

            {previewHtml && (
              <div style={cardStyle}>
                <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)" }}>미리보기</p>
                <iframe
                  ref={iframeRef}
                  srcDoc={previewHtml}
                  style={{ width: "100%", height: 700, border: "1px solid var(--surface-container-highest)", borderRadius: 6 }}
                  title="뉴스레터 미리보기"
                />
              </div>
            )}

            {/* ── 행사 이미지 관리 ── */}
            <div style={{ ...cardStyle, marginTop: 8 }}>
              <button
                onClick={() => {
                  const next = !imageEditorOpen;
                  setImageEditorOpen(next);
                  if (next && imageEvents.length === 0) fetchImageEvents();
                }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", background: "none", border: "none", cursor: "pointer",
                  fontSize: 14, fontWeight: 600, color: "var(--on-surface)", padding: 0,
                }}
              >
                <span>🖼️ EZ Letter Pick 이미지 관리</span>
                <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>{imageEditorOpen ? "▲" : "▼"}</span>
              </button>

              {imageEditorOpen && (
                <div style={{ marginTop: 16 }}>
                  {imageEventsLoading ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--on-surface-variant)", fontSize: 13 }}>
                      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />불러오는 중...
                    </div>
                  ) : imageEvents.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>90일 이내 발행된 행사가 없습니다.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--on-surface-variant)" }}>
                        이미지 URL을 직접 입력하거나 비워두면 웹사이트 대표 이미지를 자동 사용합니다.
                      </p>
                      {imageEvents.map((ev) => (
                        <div key={ev.id} style={{
                          display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center",
                          padding: "10px 12px", borderRadius: 8,
                          background: "var(--surface-container-low)",
                        }}>
                          {/* 썸네일 */}
                          <div style={{ width: 48, height: 32, borderRadius: 4, overflow: "hidden", background: "var(--surface-container-highest)", flexShrink: 0 }}>
                            {(imageEdits[ev.id] || ev.image_url) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={imageEdits[ev.id] || ev.image_url || ""}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                              />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🖼</div>
                            )}
                          </div>
                          {/* 행사 정보 + URL 입력 */}
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {ev.event_name}
                              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: "var(--on-surface-variant)" }}>
                                {ev.start_date}{ev.end_date && ev.end_date !== ev.start_date ? ` ~ ${ev.end_date}` : ""}
                              </span>
                            </p>
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input
                                type="text"
                                value={imageEdits[ev.id] ?? ""}
                                onChange={(e) => setImageEdits((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                                placeholder="이미지 직접 URL (.jpg/.png)"
                                style={{
                                  flex: 1, height: 28, padding: "0 8px", borderRadius: 4, fontSize: 11,
                                  border: "1px solid var(--surface-container-highest)",
                                  background: "var(--surface-container-lowest)",
                                  color: "var(--on-surface)", outline: "none", boxSizing: "border-box",
                                }}
                                onKeyDown={(e) => e.key === "Enter" && saveImageUrl(ev.id)}
                              />
                              {ev.website && (
                                <button
                                  onClick={() => autoFetchOgImage(ev)}
                                  disabled={imageAutoFetching.has(ev.id)}
                                  style={{
                                    height: 28, padding: "0 8px", borderRadius: 4, border: "1px solid var(--surface-container-highest)",
                                    background: "var(--surface-container-low)", fontSize: 11, cursor: imageAutoFetching.has(ev.id) ? "not-allowed" : "pointer",
                                    whiteSpace: "nowrap", color: "var(--on-surface-variant)",
                                  }}
                                  title="홈페이지에서 대표 이미지 자동 수집"
                                >
                                  {imageAutoFetching.has(ev.id) ? "..." : "🔄 자동"}
                                </button>
                              )}
                            </div>
                          </div>
                          {/* 저장 버튼 */}
                          <button
                            onClick={() => saveImageUrl(ev.id)}
                            disabled={imageSaving.has(ev.id)}
                            style={{
                              height: 28, padding: "0 10px", borderRadius: 4, border: "none",
                              background: imageSaved.has(ev.id) ? "#D4EDDA" : "var(--primary)",
                              color: imageSaved.has(ev.id) ? "#155724" : "#fff",
                              fontSize: 12, fontWeight: 600, cursor: imageSaving.has(ev.id) ? "not-allowed" : "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {imageSaving.has(ev.id) ? "..." : imageSaved.has(ev.id) ? "저장됨 ✓" : "저장"}
                          </button>
                          {/* 삭제(비우기) 버튼 */}
                          {(imageEdits[ev.id] || ev.image_url) && (
                            <button
                              onClick={() => setImageEdits((prev) => ({ ...prev, [ev.id]: "" }))}
                              style={{ height: 28, padding: "0 8px", borderRadius: 4, border: "none", background: "transparent", color: "var(--on-surface-variant)", fontSize: 13, cursor: "pointer" }}
                              title="URL 지우기"
                            >×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 자동 발송 설정 아코디언 ── */}
            <div style={{ ...cardStyle, marginTop: 8 }}>
              <button
                onClick={() => setCronOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", background: "none", border: "none", cursor: "pointer",
                  fontSize: 14, fontWeight: 600, color: "var(--on-surface)", padding: 0,
                }}
              >
                <span>⚙️ 자동 발송 설정</span>
                <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>{cronOpen ? "▲" : "▼"}</span>
              </button>

              {cronOpen && (
                <div style={{ marginTop: 16 }}>
                  {/* enabled 토글 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)", minWidth: 80 }}>자동 발송</label>
                    <button
                      onClick={() => setCronSettings(s => ({ ...s, enabled: !s.enabled }))}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}
                      title={cronSettings.enabled ? "비활성화" : "활성화"}
                    >
                      {cronSettings.enabled ? (
                        <ToggleRight size={28} color="var(--primary)" />
                      ) : (
                        <ToggleLeft size={28} color="var(--on-surface-variant)" />
                      )}
                    </button>
                    <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                      {cronSettings.enabled ? "활성화됨" : "비활성화됨"}
                    </span>
                  </div>

                  {/* send_days 다중 선택 */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)", minWidth: 80, paddingTop: 4 }}>발송 요일</label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {DAY_LABELS.map((label, idx) => {
                        const checked = cronSettings.send_days.includes(idx);
                        return (
                          <label key={idx} style={{
                            display: "flex", alignItems: "center", gap: 4,
                            padding: "5px 10px", borderRadius: 6, cursor: "pointer",
                            border: `1px solid ${checked ? "var(--primary)" : "var(--surface-container-highest)"}`,
                            background: checked ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "var(--surface-container-low)",
                            fontSize: 13, fontWeight: checked ? 600 : 400,
                            color: checked ? "var(--primary)" : "var(--on-surface)",
                            userSelect: "none",
                          }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setCronSettings(s => ({
                                  ...s,
                                  send_days: checked
                                    ? s.send_days.filter(d => d !== idx)
                                    : [...s.send_days, idx].sort(),
                                }));
                              }}
                              style={{ display: "none" }}
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* send_hour 선택 (KST) */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)", minWidth: 80 }}>발송 시간</label>
                    <select
                      value={cronSettings.send_hour}
                      onChange={(e) => setCronSettings(s => ({ ...s, send_hour: Number(e.target.value) }))}
                      style={{
                        padding: "7px 12px", borderRadius: 6,
                        border: "1px solid var(--surface-container-highest)",
                        background: "var(--surface-container-low)",
                        color: "var(--on-surface)", fontSize: 13,
                      }}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {h < 12
                            ? `오전 ${h === 0 ? 12 : h}시 (${String(h).padStart(2,"0")}:00 KST)`
                            : `오후 ${h === 12 ? 12 : h - 12}시 (${String(h).padStart(2,"0")}:00 KST)`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* default_editorial */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--on-surface-variant)" }}>
                      기본 인사말 (자동 발송 시 사용)
                    </label>
                    <textarea
                      value={cronSettings.default_editorial ?? ""}
                      onChange={(e) => setCronSettings(s => ({ ...s, default_editorial: e.target.value }))}
                      placeholder="자동 발송 시 사용할 기본 인사말..."
                      rows={3}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        padding: "10px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--surface-container-highest)",
                        background: "var(--surface-container-low)",
                        color: "var(--on-surface)",
                        fontSize: 13,
                        lineHeight: 1.6,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <button
                    onClick={handleSaveCronSettings}
                    disabled={cronSaving}
                    style={{
                      padding: "8px 18px", borderRadius: 6, border: "none",
                      background: "var(--primary)", color: "#fff", fontWeight: 600,
                      fontSize: 13, cursor: cronSaving ? "not-allowed" : "pointer",
                      opacity: cronSaving ? 0.6 : 1,
                    }}
                  >
                    {cronSaving ? "저장 중..." : cronSaved ? "저장됨 ✓" : "설정 저장"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SUBSCRIBERS TAB ── */}
        {tab === "subscribers" && (
          <div>
            <div style={cardStyle}>
              <form onSubmit={handleAddSubscriber} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="이메일 주소"
                  required
                  style={{
                    flex: "1 1 200px", padding: "8px 12px", borderRadius: 6,
                    border: "1px solid var(--surface-container-highest)",
                    background: "var(--surface-container-low)",
                    color: "var(--on-surface)", fontSize: 14,
                  }}
                />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="이름 (선택)"
                  style={{
                    flex: "1 1 140px", padding: "8px 12px", borderRadius: 6,
                    border: "1px solid var(--surface-container-highest)",
                    background: "var(--surface-container-low)",
                    color: "var(--on-surface)", fontSize: 14,
                  }}
                />
                <button
                  type="submit"
                  disabled={addingSubscriber}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 14px", borderRadius: 6, border: "none",
                    background: "var(--primary)", color: "#fff",
                    fontWeight: 600, fontSize: 14,
                    cursor: addingSubscriber ? "not-allowed" : "pointer",
                    opacity: addingSubscriber ? 0.6 : 1,
                  }}
                >
                  <Plus size={14} />
                  추가
                </button>
              </form>

              {/* 엑셀 업로드 */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--surface-container-highest)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)" }}>
                    엑셀 일괄 업로드
                  </p>
                  <a
                    href="/api/admin/newsletter/subscribers/template"
                    download="subscribers_template.xlsx"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "4px 10px", borderRadius: 6,
                      border: "1px solid var(--primary)",
                      background: "transparent", color: "var(--primary)",
                      fontSize: 12, fontWeight: 500, textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    ⬇ 템플릿 다운로드
                  </a>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--on-surface-variant)" }}>
                  <strong>email</strong> (필수) · <strong>name</strong> (선택) 컬럼이 있는 xlsx 파일을 업로드하세요.
                  템플릿을 먼저 받아서 작성하면 편해요.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => excelFileRef.current?.click()}
                    disabled={excelUploading}
                    style={{
                      padding: "7px 14px", borderRadius: 6,
                      border: "1px solid var(--surface-container-highest)",
                      background: "var(--surface-container)", color: "var(--on-surface)",
                      fontSize: 13, cursor: excelUploading ? "not-allowed" : "pointer",
                      fontWeight: 500, opacity: excelUploading ? 0.6 : 1,
                    }}
                  >
                    {excelUploading ? "업로드 중..." : "파일 선택"}
                  </button>
                  {excelResult && (
                    <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                      <span>✅ 추가 {excelResult.inserted}명 / 중복 스킵 {excelResult.skipped}명</span>
                      {excelResult.duplicates.length > 0 && (
                        <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 6, background: "#FFF3CD", color: "#856404", lineHeight: 1.6 }}>
                          <strong>이미 등록된 이메일 ({excelResult.duplicates.length}명):</strong><br />
                          {excelResult.duplicates.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <input
                  ref={excelFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={handleExcelUpload}
                />
              </div>

              {subError && (
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "#c0392b" }}>{subError}</p>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>
                총 <strong>{subscribers.length}명</strong> / 활성 <strong>{subscribers.filter((s) => s.is_active).length}명</strong>
              </span>
              {selectedSubIds.size > 0 && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleBulkActivate}
                    disabled={bulkActivating}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 14px", borderRadius: 6, border: "none",
                      background: "#16a34a", color: "#fff",
                      fontWeight: 600, fontSize: 13,
                      cursor: bulkActivating ? "not-allowed" : "pointer",
                      opacity: bulkActivating ? 0.6 : 1,
                    }}
                  >
                    {bulkActivating ? "처리 중..." : `선택 ${selectedSubIds.size}명 활성화`}
                  </button>
                  <button
                    onClick={handleBulkDeactivate}
                    disabled={bulkDeactivating}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 14px", borderRadius: 6, border: "none",
                      background: "#f59e0b", color: "#fff",
                      fontWeight: 600, fontSize: 13,
                      cursor: bulkDeactivating ? "not-allowed" : "pointer",
                      opacity: bulkDeactivating ? 0.6 : 1,
                    }}
                  >
                    {bulkDeactivating ? "처리 중..." : `선택 ${selectedSubIds.size}명 비활성화`}
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 14px", borderRadius: 6, border: "none",
                      background: "#dc2626", color: "#fff",
                      fontWeight: 600, fontSize: 13,
                      cursor: bulkDeleting ? "not-allowed" : "pointer",
                      opacity: bulkDeleting ? 0.6 : 1,
                    }}
                  >
                    <Trash2 size={13} />
                    {bulkDeleting ? "삭제 중..." : `선택 ${selectedSubIds.size}명 삭제`}
                  </button>
                </div>
              )}
            </div>

            {subLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--on-surface-variant)", fontSize: 14 }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                불러오는 중...
              </div>
            ) : (
              <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-container-high)" }}>
                      <th style={{ ...thStyle, textAlign: "center", width: 36 }}>
                        <input
                          type="checkbox"
                          checked={subscribers.length > 0 && subscribers.every((s) => selectedSubIds.has(s.id))}
                          onChange={() => {
                            const allSelected = subscribers.every((s) => selectedSubIds.has(s.id));
                            setSelectedSubIds(allSelected ? new Set() : new Set(subscribers.map((s) => s.id)));
                          }}
                          style={{ width: 14, height: 14, cursor: "pointer" }}
                        />
                      </th>
                      <th style={thStyle}>이름</th>
                      <th style={thStyle}>이메일</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>활성</th>
                      <th style={thStyle}>추가일</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                          등록된 수신자가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      subscribers.map((sub) => (
                        <tr key={sub.id} style={{
                          borderTop: "1px solid var(--surface-container-highest)",
                          background: selectedSubIds.has(sub.id) ? "color-mix(in srgb, #dc2626 6%, transparent)" : undefined,
                        }}>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={selectedSubIds.has(sub.id)}
                              onChange={() => {
                                setSelectedSubIds((prev) => {
                                  const s = new Set(prev);
                                  s.has(sub.id) ? s.delete(sub.id) : s.add(sub.id);
                                  return s;
                                });
                              }}
                              style={{ width: 14, height: 14, cursor: "pointer" }}
                            />
                          </td>
                          <td style={tdStyle}>{sub.name ?? "-"}</td>
                          <td style={tdStyle}>{sub.email}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <button
                              onClick={() => handleToggle(sub)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}
                              title={sub.is_active ? "비활성화" : "활성화"}
                            >
                              {sub.is_active ? (
                                <ToggleRight size={22} color="var(--primary)" />
                              ) : (
                                <ToggleLeft size={22} color="var(--on-surface-variant)" />
                              )}
                            </button>
                          </td>
                          <td style={tdStyle}>
                            {new Date(sub.created_at).toLocaleDateString("ko-KR")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <button
                              onClick={() => handleDelete(sub.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0, color: "#c0392b" }}
                              title="삭제"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div>
            {historyLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--on-surface-variant)", fontSize: 14 }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                불러오는 중...
              </div>
            ) : (
              <>
                <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-container-high)" }}>
                        <th style={thStyle}>Vol</th>
                        <th style={thStyle}>날짜</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>발송</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>성공</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>실패</th>
                        <th style={thStyle}>상태</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>재발송</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: "20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                            발송 이력이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        issues.map((issue) => {
                          const s = issue.status;
                          const statusBg    = s === "sent" ? "#D4EDDA" : s === "partial" ? "#FFF3CD" : s === "sending" ? "#D1ECF1" : s === "failed" ? "#F8D7DA" : "var(--surface-container-highest)";
                          const statusColor = s === "sent" ? "#155724" : s === "partial" ? "#856404" : s === "sending" ? "#0c5460" : s === "failed" ? "#721C24" : "var(--on-surface-variant)";
                          const statusLabel = s === "sent" ? "발송완료" : s === "partial" ? "일부발송" : s === "sending" ? "발송중..." : s === "failed" ? "실패" : s === "draft" ? "임시저장" : s;
                          const canResend   = (s === "partial" || s === "failed" || s === "sending") && !!issue.html_content;
                          const unsent      = unsentMap[issue.id] ?? [];
                          const checked     = checkedEmails[issue.id] ?? new Set<string>();
                          const isPanelOpen = unsentPanel === issue.id;
                          const allEmails   = unsent.map(u => u.email);
                          const allChecked  = allEmails.length > 0 && allEmails.every(e => checked.has(e));

                          return (
                          <React.Fragment key={issue.id}>
                          <tr style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
                            <td style={tdStyle}>Vol.{issue.vol_number}</td>
                            <td style={tdStyle}>
                              {issue.sent_at
                                ? new Date(issue.sent_at).toLocaleDateString("ko-KR")
                                : new Date(issue.created_at).toLocaleDateString("ko-KR")}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              <button onClick={() => fetchIssueLogs(issue, "all")}
                                style={{ background: "none", border: "none", cursor: "pointer",
                                  color: "var(--primary)", fontWeight: 700, fontSize: 13, textDecoration: "underline" }}
                                title="전체 발송 내역 보기">
                                {issue.total_sent + issue.total_failed}
                              </button>
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center", color: "#155724", fontWeight: 600 }}>
                              {issue.total_sent}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              {issue.total_failed > 0 ? (
                                <button onClick={() => fetchIssueLogs(issue, "failed")}
                                  style={{ background: "none", border: "none", cursor: "pointer",
                                    color: "#c0392b", fontWeight: 700, fontSize: 13, textDecoration: "underline" }}
                                  title="실패 로그만 보기">
                                  {issue.total_failed}
                                </button>
                              ) : <span>0</span>}
                            </td>
                            <td style={tdStyle}>
                              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4,
                                fontSize: 11, fontWeight: 600, background: statusBg, color: statusColor }}>
                                {statusLabel}
                              </span>
                              {s === "sending" && (
                                <button
                                  onClick={() => handleRecoverStatus(issue)}
                                  disabled={recoveringId === issue.id}
                                  title="실제 발송 로그 기준으로 상태 복구"
                                  style={{
                                    marginLeft: 6, padding: "2px 7px", borderRadius: 4, fontSize: 11,
                                    border: "1px solid #0c5460", background: "transparent", color: "#0c5460",
                                    cursor: recoveringId === issue.id ? "not-allowed" : "pointer",
                                    opacity: recoveringId === issue.id ? 0.6 : 1, fontWeight: 600,
                                  }}
                                >
                                  {recoveringId === issue.id ? "..." : "복구"}
                                </button>
                              )}
                            </td>
                            {/* 미수신자 보기 버튼 */}
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              {canResend ? (
                                <button
                                  onClick={() => toggleUnsentPanel(issue)}
                                  style={{
                                    padding: "4px 10px", borderRadius: 5,
                                    border: `1px solid ${isPanelOpen ? "var(--primary)" : "#aaa"}`,
                                    background: isPanelOpen ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--surface-container)",
                                    color: isPanelOpen ? "var(--primary)" : "var(--on-surface-variant)",
                                    fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
                                  }}
                                >
                                  {unsentLoading === issue.id
                                    ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite", verticalAlign: "middle" }} />
                                    : isPanelOpen ? "▲ 닫기" : "↩ 미수신자"}
                                </button>
                              ) : (
                                <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>—</span>
                              )}
                            </td>
                          </tr>

                          {/* 재발송 결과 메시지 */}
                          {resendResult[issue.id] && (
                            <tr key={`${issue.id}-result`}
                              style={{ background: resendResult[issue.id].startsWith("✅") ? "#D4EDDA" : "#F8D7DA" }}>
                              <td colSpan={7} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600,
                                color: resendResult[issue.id].startsWith("✅") ? "#155724" : "#721C24" }}>
                                {resendResult[issue.id]}
                              </td>
                            </tr>
                          )}

                          {/* 미수신자 패널 */}
                          {isPanelOpen && (
                            <tr key={`${issue.id}-unsent`}>
                              <td colSpan={7} style={{ padding: "0 0 4px" }}>
                                <div style={{
                                  margin: "0 4px 8px",
                                  border: "1px solid var(--surface-container-highest)",
                                  borderRadius: 8, overflow: "hidden",
                                  background: "var(--surface-container-low)",
                                }}>
                                  {/* 패널 헤더 */}
                                  <div style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    padding: "10px 14px",
                                    background: "var(--surface-container)",
                                    borderBottom: "1px solid var(--surface-container-highest)",
                                  }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                                        <input
                                          type="checkbox"
                                          checked={allChecked}
                                          onChange={() => toggleAllCheck(issue.id, allEmails)}
                                          style={{ width: 15, height: 15, cursor: "pointer" }}
                                        />
                                        전체선택
                                      </label>
                                      <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                                        미수신자 {unsent.length}명 중 {checked.size}명 선택
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => handleResend(issue)}
                                      disabled={resendingId === issue.id || checked.size === 0}
                                      style={{
                                        display: "flex", alignItems: "center", gap: 5,
                                        padding: "6px 14px", borderRadius: 6, border: "none",
                                        background: checked.size === 0 ? "var(--surface-container-highest)" : "var(--primary)",
                                        color: checked.size === 0 ? "var(--on-surface-variant)" : "#fff",
                                        fontWeight: 700, fontSize: 13,
                                        cursor: (resendingId === issue.id || checked.size === 0) ? "not-allowed" : "pointer",
                                        opacity: resendingId === issue.id ? 0.6 : 1,
                                      }}
                                    >
                                      {resendingId === issue.id
                                        ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> 발송 중...</>
                                        : `↩ ${checked.size}명에게 재발송`}
                                    </button>
                                  </div>

                                  {/* 미수신자 목록 */}
                                  {unsentLoading === issue.id ? (
                                    <div style={{ padding: "16px 14px", fontSize: 13, color: "var(--on-surface-variant)" }}>
                                      불러오는 중...
                                    </div>
                                  ) : unsent.length === 0 ? (
                                    <div style={{ padding: "16px 14px", fontSize: 13, color: "#155724", fontWeight: 600 }}>
                                      ✅ 모든 활성 수신자가 이미 수신했습니다.
                                    </div>
                                  ) : (
                                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                                      {unsent.map(u => {
                                        const err = u.error_message;
                                        const isTimeout = err?.includes("timeout") || err?.includes("Too many concurrent");
                                        const isAddrErr = !isTimeout && !!err;
                                        const errLabel = isTimeout ? "재시도가능" : isAddrErr ? "주소오류" : null;
                                        const errStyle = isAddrErr
                                          ? { background: "#F8D7DA", color: "#721C24" }
                                          : { background: "#FFF3CD", color: "#856404" };
                                        return (
                                          <div key={u.email} style={{
                                            display: "flex", alignItems: "center", gap: 8,
                                            padding: "8px 14px",
                                            borderBottom: "1px solid var(--surface-container-highest)",
                                            background: checked.has(u.email)
                                              ? "color-mix(in srgb, var(--primary) 6%, transparent)"
                                              : "transparent",
                                          }}>
                                            <input
                                              type="checkbox"
                                              checked={checked.has(u.email)}
                                              onChange={() => toggleCheck(issue.id, u.email)}
                                              style={{ width: 14, height: 14, cursor: "pointer", flexShrink: 0 }}
                                            />
                                            <span style={{ fontSize: 13, color: "var(--on-surface)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
                                            {u.name && (
                                              <span style={{ fontSize: 12, color: "var(--on-surface-variant)", flexShrink: 0 }}>{u.name}</span>
                                            )}
                                            {errLabel && (
                                              <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, fontWeight: 600, flexShrink: 0, ...errStyle }}>
                                                {errLabel}
                                              </span>
                                            )}
                                            {isAddrErr && (
                                              <button
                                                onClick={() => handleDeactivate(issue.id, u.id, u.email)}
                                                disabled={deactivating === u.id}
                                                title="구독 비활성화"
                                                style={{
                                                  flexShrink: 0, padding: "2px 7px", borderRadius: 4, border: "1px solid #F8D7DA",
                                                  background: "transparent", color: "#721C24", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                                  opacity: deactivating === u.id ? 0.5 : 1,
                                                }}
                                              >
                                                {deactivating === u.id ? "..." : "비활성화"}
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedIssue && (
                  <div style={{ marginTop: 12, background: "var(--surface-container)", borderRadius: 8, padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: logMode === "failed" ? "#c0392b" : "var(--on-surface)" }}>
                        Vol.{selectedIssue.vol_number} {logMode === "failed" ? "실패 내역" : "전체 발송 내역"}
                      </p>
                      <button
                        onClick={() => { setSelectedIssue(null); setIssueLogs([]); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--on-surface-variant)", lineHeight: 1 }}
                      >×</button>
                    </div>
                    {logsLoading ? (
                      <p style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>불러오는 중...</p>
                    ) : issueLogs.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>로그가 없습니다.</p>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "var(--surface-container-high)" }}>
                            <th style={{ ...thStyle, fontSize: 12 }}>이메일</th>
                            <th style={{ ...thStyle, fontSize: 12, textAlign: "center" }}>상태</th>
                            {logMode === "all" && <th style={{ ...thStyle, fontSize: 12 }}>오류</th>}
                            <th style={{ ...thStyle, fontSize: 12 }}>시간</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issueLogs.map(log => (
                            <tr key={log.id} style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
                              <td style={{ ...tdStyle, fontSize: 12 }}>{log.email}</td>
                              <td style={{ ...tdStyle, fontSize: 12, textAlign: "center" }}>
                                <span style={{
                                  display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                                  background: log.status === "success" ? "#D4EDDA" : "#F8D7DA",
                                  color: log.status === "success" ? "#155724" : "#721C24",
                                }}>
                                  {log.status === "success" ? "성공" : "실패"}
                                </span>
                              </td>
                              {logMode === "all" && (
                                <td style={{ ...tdStyle, fontSize: 12, color: "#c0392b" }}>{log.error_message ?? "-"}</td>
                              )}
                              <td style={{ ...tdStyle, fontSize: 12, whiteSpace: "nowrap" }}>
                                {log.sent_at ? new Date(log.sent_at).toLocaleString("ko-KR") : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

        {/* ── MANUAL TAB ── */}
        {tab === "manual" && (
          <div style={{ fontSize: 14, lineHeight: 1.75, color: "var(--on-surface)" }}>

            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--on-surface-variant)" }}>
              뉴스레터 발간 순서에 따라 정리한 운영 가이드입니다.
            </p>

            <Section title="STEP 1 · 뉴스 콘텐츠 준비">
              <Item text="뉴스룸 관리자에서 이번 호에 넣을 기사를 발행 상태로 확인" />
              <Item text="카테고리별 대표 기사는 순서를 맨 위로 올려 TOP 지정" />
              <Indent><b>카드 선정 로직 (카테고리별 2개):</b></Indent>
              <Indent>① 1번 카드: 뉴스룸에서 순서를 맨 위로 올린 기사 (순서 변경 시 즉시 반영)</Indent>
              <Indent>② 2번 카드: 최근 2주 내 가장 최근 발행 기사 (1번과 중복 제외)</Indent>
              <Indent><b>카테고리:</b> MICE / Tourism / EZPMP / AI — 각각 독립 선정</Indent>
              <Note>모든 뉴스 카드 클릭 시 EZ데이터허브(micedx.ezpmp.co.kr)로 연결됩니다.</Note>
            </Section>

            <Section title="STEP 2 · 행사 데이터 확인">
              <Item text="EZ Letter Pick: 14일 이내 행사 우선 선정 (부족하면 30일→90일로 보충), 최근 2개 호 중복 제외" />
              <Indent><b>이미지 우선순위:</b> 직접 등록 이미지 → 네이버 이미지 자동 검색 → 웹사이트 og:image → EZ 로고</Indent>
              <Indent><b>설명 문구 우선순위:</b> DB description → Gemini AI 자동 생성 후 DB 저장</Indent>
              <Indent><b>Pick 선정 기준:</b> MICE·전시·박람회·국제회의 + 관광·환경·콘텐츠·AI 분야 + 주요 컨벤션센터 보정</Indent>
              <Item text="Weekly Event List: 이번 주 시작 행사 중 스코어 13점 이상만 표시 (최대 7개, Pick 제외)" />
              <Indent><b>자동 제외 키워드:</b> 정기총회, 임시총회, 이사회, 간담회, 위원회, 강의, 교육, 워크숍, 세미나, 육아, 웨딩 등</Indent>
              <Note>산하 행사가 중복 노출되거나 관련 없는 행사가 뜨면 행사 관리에서 해당 행사를 비공개로 변경하세요.</Note>
            </Section>

            <Section title="STEP 3 · 인사말 작성">
              <Item text="'AI로 작성' 클릭 → 이번 호 뉴스 제목 + Pick 행사명 기반으로 Gemini가 자동 생성" />
              <Item text="현재 월·계절·업계 분위기 반영, 마지막은 'EZ하게 시작해볼까요?' 뉘앙스로 마무리" />
              <Item text="생성 후 직접 수정 가능" />
              <Note>페이지를 열면 콘텐츠를 백그라운드에서 미리 로드하므로 버튼 클릭 즉시 생성됩니다.</Note>
            </Section>

            <Section title="STEP 4 · 미리보기 확인">
              <Item text="'미리보기' 클릭 → 실제 이메일 레이아웃으로 확인" />
              <Item text="뉴스 카드·Pick 행사·Weekly List·인사말 전체 검토" />
              <Note>미리보기는 몇 번을 눌러도 Vol 번호가 올라가지 않습니다. DB에 기록되지 않습니다.</Note>
            </Section>

            <Section title="STEP 5 · 발송">
              <Item text="'발송' 버튼 클릭 → 활성 수신자 전체에게 발송" />
              <Item text="발송 완료 시 자동으로 기록되며 다음 호 Vol 번호가 자동 증가합니다." />
              <Note>Vol 번호는 실제 발송 완료 건수 + 1로 계산됩니다. 진짜 발송 전까지 Vol.01이 유지됩니다.</Note>
            </Section>

            <Section title="STEP 6 · 발송 후 확인">
              <Item text="'이력' 탭에서 발송 건수·실패 건수 확인" />
              <Item text="실패 건수 클릭 시 실패한 이메일 주소와 오류 메시지 확인 가능" />
            </Section>

            <div style={{ borderTop: "1px solid var(--surface-container-highest)", margin: "20px 0 14px", paddingTop: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--on-surface-variant)", margin: "0 0 10px", letterSpacing: "0.05em" }}>
                ─ 사전 설정 & 관리
              </p>
            </div>

            <Section title="📋 수신자 관리">
              <Item text="개별 추가: 이메일 + 이름(선택) 입력 후 추가" />
              <Item text="엑셀 일괄 업로드: '템플릿 다운로드' 버튼으로 양식 받아 email(필수)·name(선택) 채운 뒤 업로드" />
              <Item text="토글로 개별 활성/비활성 전환 — 비활성 수신자에게는 발송되지 않음" />
              <Note>중복 이메일은 자동 스킵됩니다.</Note>
            </Section>

            <Section title="⚙️ 자동 발송 (Cron) 설정">
              <Item text="발송 요일을 체크박스로 다중 선택 — 해당 요일이 아닌 날은 자동 스킵" />
              <Item text="기본 인사말 설정 가능 (자동 발송 시 사용, 비워두면 빈 인사말)" />
            </Section>

            <Section title="🤖 자동 큐레이션 (뉴스 수집)">
              <Item text="cron-job.org에서 매주 화·목 09:00 KST에 자동 실행" />
              <Item text="RSS 소스 관리(/admin/rss)에 등록된 활성 소스에서 기사를 자동 수집·발행" />
              <Item text="실패 알림: k2cow0610@ezpmp.co.kr 로 이메일 발송" />
              <Note>수동 실행: 정합성 관리 → 큐레이션 보드 → 수동 실행 버튼</Note>
            </Section>

            <Section title="🗂️ 행사 데이터 관리">
              <Item text="정합성 관리 → 행사 탭에서 행사명·센터·주최기관·기간 직접 편집 (셀 클릭)" />
              <Item text="비공개 처리 시 팝업 → 키워드 추가하면 다음 수집 때 동일 유형 자동 비공개" />
              <Item text="🚫 자동 비공개 키워드 관리: 행사 탭 상단에서 키워드 추가/삭제" />
              <Item text="중복/불량 정리: 행사 탭 하단 → 미리보기 확인 후 실행 (복원 불가)" />
              <Note>행사 데이터 수집: 정합성 관리 → 행사 탭 → 📡 행사 데이터 수집 버튼 (쇼알라 + KEOA)</Note>
            </Section>

            <Section title="🖼️ 행사 이미지 직접 등록">
              <Item text="발송 탭 → 🖼️ Pick 이미지 관리에서 직접 URL 입력 후 저장 → 저장된 이미지가 최우선 적용" />
              <Item text="자동으로 찾으려면 🔄 자동 버튼 클릭 (네이버 이미지 자동 검색)" />
              <Item text="목록에는 오늘 이후 행사 중 과거에 발송된 적 없는 행사만 표시됩니다. 이미 EZ Letter에 포함된 행사는 자동으로 제외됩니다." />
              <Note>이미지 우선순위: 직접 등록 URL → 네이버 검색 → 홈페이지 og:image → EZ 로고</Note>
            </Section>

          </div>
        )}

        {/* ── GMAIL TAB ── */}
        {tab === "gmail" && (
          <div style={{ maxWidth: 520 }}>
            {/* 상태 카드 */}
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 16 }}>
              {gmailStatus === "loading" && <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--on-surface-variant)" }} />}
              {gmailStatus === "connected" && <CheckCircle size={20} color="#2e7d32" />}
              {gmailStatus === "disconnected" && <XCircle size={20} color="#c62828" />}
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                  {gmailStatus === "loading" && "확인 중..."}
                  {gmailStatus === "connected" && "Gmail 연동됨"}
                  {gmailStatus === "disconnected" && "연동 안 됨"}
                </div>
                {gmailUpdatedAt && (
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                    마지막 인증: {new Date(gmailUpdatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </div>
                )}
              </div>
            </div>

            {/* 인증 버튼 */}
            <a
              href="/api/gmail/auth"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "11px 22px", borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: gmailStatus === "connected" ? "var(--surface-container-high)" : "var(--on-surface)",
                color: gmailStatus === "connected" ? "var(--on-surface)" : "var(--surface)",
                textDecoration: "none", marginBottom: 24,
              }}
            >
              <ExternalLink size={15} />
              {gmailStatus === "connected" ? "다시 인증 (재연동)" : "Google 계정으로 인증"}
            </a>

            {/* 안내 */}
            <div style={{ ...cardStyle, fontSize: 13, lineHeight: 1.75, color: "var(--on-surface-variant)" }}>
              <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--on-surface)", fontSize: 14 }}>연동 용도</p>
              <ul style={{ margin: "0 0 16px", paddingLeft: 18 }}>
                <li>뉴스레터 <strong>자동 발송</strong>에 사용 (ez.micedx1@gmail.com)</li>
                <li>RSS 소스에서 <strong>Gmail 뉴스레터 수집</strong> 시에도 동일하게 사용</li>
              </ul>
              <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--on-surface)", fontSize: 14 }}>토큰 만료 시</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>발송 또는 수집 실패 → 이 화면에서 [다시 인증] 클릭</li>
                <li>인증은 1회로 지속 유지됩니다.</li>
              </ul>
            </div>
          </div>
        )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── 매뉴얼 UI 컴포넌트 ──────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface-container)", borderRadius: 10, padding: "18px 20px", marginBottom: 14 }}>
      <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "var(--on-surface)" }}>{title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}
function Step({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ minWidth: 22, height: 22, borderRadius: "50%", background: "var(--primary)", color: "#fff",
        fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {n}
      </span>
      <span style={{ fontSize: 13, color: "var(--on-surface)", paddingTop: 2 }}>{text}</span>
    </div>
  );
}
function Item({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ color: "var(--primary)", fontWeight: 700, flexShrink: 0, fontSize: 13 }}>·</span>
      <span style={{ fontSize: 13, color: "var(--on-surface)" }}>{text}</span>
    </div>
  );
}
function Indent({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginLeft: 16, fontSize: 13, color: "var(--on-surface-variant)" }}>{children}</div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "color-mix(in srgb, var(--primary) 8%, transparent)",
      fontSize: 12, color: "var(--on-surface-variant)", borderLeft: "3px solid var(--primary)" }}>
      💡 {children}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontWeight: 600,
  color: "var(--on-surface-variant)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: "var(--on-surface)",
};
