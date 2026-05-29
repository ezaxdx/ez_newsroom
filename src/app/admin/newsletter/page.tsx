"use client";

import { useState, useEffect, useRef } from "react";
import { Trash2, ToggleLeft, ToggleRight, Plus, Loader2, Sparkles } from "lucide-react";

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
  status: string;
  total_sent: number;
  total_failed: number;
  sent_at: string | null;
  created_at: string;
};

type SendLog = { id: string; email: string; status: string; error_message: string | null; sent_at: string };
type CronSettings = { enabled: boolean; send_days: number[]; send_hour: number; default_editorial: string | null };

type Tab = "send" | "subscribers" | "history" | "manual";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default function NewsletterPage() {
  const [tab, setTab] = useState<Tab>("send");

  // ── Send tab state ──
  const [editorialText, setEditorialText] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);
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

  // ── 수신자 탭 - 엑셀 업로드 ──
  const excelFileRef = useRef<HTMLInputElement>(null);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelResult, setExcelResult] = useState<{ inserted: number; skipped: number } | null>(null);

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

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load active count and subscribers on mount
  useEffect(() => {
    fetchSubscribers();
    fetchCronSettings();
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
        body: JSON.stringify({ editorial_text: editorialText, dry_run: true }),
      });
      const json = await res.json();
      if (res.ok && json.html) {
        setPreviewHtml(json.html);
      } else {
        setSendResult({ ok: false, message: json.error ?? "미리보기 실패" });
      }
    } catch {
      setSendResult({ ok: false, message: "네트워크 오류" });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    if (!activeCount) {
      setSendResult({ ok: false, message: activeCount === null ? "수신자 수를 불러오는 중입니다. 잠시 후 다시 시도하세요." : "활성 수신자가 없습니다." });
      return;
    }
    const confirmed = window.confirm(
      `${activeCount}명의 수신자에게 뉴스레터를 발송합니다. 계속하시겠습니까?`
    );
    if (!confirmed) return;

    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/admin/newsletter/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editorial_text: editorialText, dry_run: false }),
      });
      const json = await res.json();
      if (res.ok) {
        setSendResult({
          ok: true,
          message: `발송 완료: Vol.${json.vol_number} · 성공 ${json.total_sent}건 / 실패 ${json.total_failed}건`,
        });
      } else {
        setSendResult({ ok: false, message: json.error ?? "발송 실패" });
      }
    } catch {
      setSendResult({ ok: false, message: "네트워크 오류" });
    } finally {
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
        if (deleted?.is_active) {
          setActiveCount((prev) => (prev !== null ? prev - 1 : null));
        }
      }
    } catch {
      // ignore
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
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
      const subs = rows.map(r => ({
        email: (r["email"] || r["이메일"] || "").toString().trim(),
        name: (r["name"] || r["이름"] || "").toString().trim() || undefined,
      })).filter(s => s.email);
      const res = await fetch("/api/admin/newsletter/subscribers/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribers: subs }),
      });
      const json = await res.json();
      if (res.ok) {
        setExcelResult({ inserted: json.inserted, skipped: json.skipped });
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

  async function fetchFailureLogs(issue: Issue) {
    if (selectedIssue?.id === issue.id) {
      setSelectedIssue(null);
      setIssueLogs([]);
      return;
    }
    setSelectedIssue(issue);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/admin/newsletter/logs?issue_id=${issue.id}&status=failed`);
      const json = await res.json();
      setIssueLogs(json.data ?? []);
    } catch {
      setIssueLogs([]);
    } finally {
      setLogsLoading(false);
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

              <button
                onClick={handleSend}
                disabled={sending}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 18px", borderRadius: 6, border: "none",
                  background: "var(--primary)", color: "#fff", fontWeight: 600,
                  fontSize: 14, cursor: sending ? "not-allowed" : "pointer",
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                발송 {activeCount !== null ? `(${activeCount}명)` : ""}
              </button>

              {activeCount !== null && (
                <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>
                  현재 활성 수신자: <strong>{activeCount}명</strong>
                </span>
              )}
            </div>

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
                <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)" }}>
                  엑셀 일괄 업로드
                </p>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--on-surface-variant)" }}>
                  이메일(email) · 이름(name) 컬럼이 있는 xlsx 파일을 업로드하세요.
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
                    <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                      추가 {excelResult.inserted}명 / 중복 스킵 {excelResult.skipped}명
                    </span>
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

            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--on-surface-variant)" }}>
              총 <strong>{subscribers.length}명</strong> / 활성 <strong>{subscribers.filter((s) => s.is_active).length}명</strong>
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
                        <td colSpan={5} style={{ padding: "20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                          등록된 수신자가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      subscribers.map((sub) => (
                        <tr key={sub.id} style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
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
                        <th style={{ ...thStyle, textAlign: "center" }}>실패</th>
                        <th style={thStyle}>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: "20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                            발송 이력이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        issues.map((issue) => (
                          <tr key={issue.id} style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
                            <td style={tdStyle}>Vol.{issue.vol_number}</td>
                            <td style={tdStyle}>
                              {issue.sent_at
                                ? new Date(issue.sent_at).toLocaleDateString("ko-KR")
                                : new Date(issue.created_at).toLocaleDateString("ko-KR")}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center" }}>{issue.total_sent}</td>
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              {issue.total_failed > 0 ? (
                                <button
                                  onClick={() => fetchFailureLogs(issue)}
                                  style={{
                                    background: "none", border: "none", cursor: "pointer",
                                    color: "#c0392b", fontWeight: 700, fontSize: 13, textDecoration: "underline",
                                  }}
                                  title="실패 로그 보기"
                                >
                                  {issue.total_failed}
                                </button>
                              ) : (
                                <span>0</span>
                              )}
                            </td>
                            <td style={tdStyle}>
                              <span style={{
                                display: "inline-block",
                                padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                                background: issue.status === "sent" ? "#D4EDDA" : "var(--surface-container-highest)",
                                color: issue.status === "sent" ? "#155724" : "var(--on-surface-variant)",
                              }}>
                                {issue.status === "sent" ? "발송완료" : issue.status === "draft" ? "임시저장" : issue.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedIssue && (
                  <div style={{ marginTop: 12, background: "var(--surface-container)", borderRadius: 8, padding: 16 }}>
                    <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#c0392b" }}>
                      Vol.{selectedIssue.vol_number} 실패 로그
                    </p>
                    {logsLoading ? (
                      <p style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>불러오는 중...</p>
                    ) : issueLogs.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>로그가 없습니다.</p>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "var(--surface-container-high)" }}>
                            <th style={{ ...thStyle, fontSize: 12 }}>이메일</th>
                            <th style={{ ...thStyle, fontSize: 12 }}>에러 메시지</th>
                            <th style={{ ...thStyle, fontSize: 12 }}>시간</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issueLogs.map(log => (
                            <tr key={log.id} style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
                              <td style={{ ...tdStyle, fontSize: 12 }}>{log.email}</td>
                              <td style={{ ...tdStyle, fontSize: 12, color: "#c0392b" }}>{log.error_message ?? "-"}</td>
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

            <Section title="📬 뉴스레터 발송 프로세스">
              <Step n={1} text="AI로 작성 클릭 → 이번 호 뉴스·행사 기반으로 인사말 자동 생성" />
              <Step n={2} text="인사말 직접 수정 (선택)" />
              <Step n={3} text="미리보기 클릭 → 실제 이메일 레이아웃 확인" />
              <Step n={4} text="발송 버튼 → 활성 수신자 전체 발송" />
              <Note>미리보기는 몇 번을 눌러도 Vol 번호가 올라가지 않습니다. 실제 발송 시에만 Vol이 증가합니다.</Note>
            </Section>

            <Section title="🔢 Vol 번호 관리">
              <Item text="status = 'sent' 인 발송 건수 + 1 로 자동 계산" />
              <Item text="테스트·미리보기는 DB에 기록되지 않으므로 Vol 영향 없음" />
              <Item text="진짜 발송 전까지 Vol.01 유지됨" />
              <Note>이전 테스트 발송이 sent로 기록된 경우 Supabase에서 status를 'draft'로 변경하면 리셋됩니다.</Note>
            </Section>

            <Section title="🌟 EZ Letter Pick (행사 카드 4개)">
              <Item text="DB의 convention_events 중 is_published=true + 오늘~90일 이내 행사 대상" />
              <Item text="EZPMP 관련 키워드·파트너 기관·선호 장소 기준으로 자동 스코어링 → 상위 4개 선정" />
              <Item text="선정 후 시작일 빠른 순 정렬" />
              <Indent>
                <b>이미지 우선순위:</b> DB image_url → 웹사이트 og:image → EZ 로고 플레이스홀더
              </Indent>
              <Indent>
                <b>설명 문구 우선순위:</b> DB description → 웹사이트 og:description → Gemini AI 생성 → DB 자동 저장
              </Indent>
              <Note>스마트테크 코리아처럼 산하 행사가 중복 노출될 경우, Supabase에서 해당 행사의 is_published를 false로 변경하세요.</Note>
            </Section>

            <Section title="📅 Weekly Event List">
              <Item text="이번 주 내 시작하는 행사 중 스코어 13점 이상만 표시 (최대 7개)" />
              <Item text="Pick 4개에 이미 포함된 행사는 자동 제외" />
              <Indent>
                <b>자동 제외 키워드:</b> 정기총회, 임시총회, 이사회, 간담회, 위원회, 강의, 교육, 워크숍, 세미나
              </Indent>
              <Note>관련 없는 행사가 뜰 경우 event-score.ts의 WEEKLY_EXCLUDE_KEYWORDS에 키워드를 추가하거나 해당 행사를 비공개 처리하세요.</Note>
            </Section>

            <Section title="🖼️ 행사 이미지 등록">
              <Item text="Supabase convention_events 테이블의 image_url 컬럼에 직접 URL 입력" />
              <Item text="비워두면 웹사이트에서 og:image 자동 수집 시도" />
              <Item text="og:image도 없으면 EZ 로고 플레이스홀더 표시" />
              <Note>흰색(투명) 로고 이미지는 흰 배경에서 안 보일 수 있으니 컬러 이미지 URL을 직접 등록하는 걸 권장합니다.</Note>
            </Section>

            <Section title="⚙️ 자동 발송 (Cron) 설정">
              <Item text="Vercel Hobby 플랜 제한: 하루 1회만 실행 가능 (매일 KST 10:00 = UTC 01:00)" />
              <Item text="발송 요일은 DB send_days 배열로 관리 — 해당 요일이 아닌 날은 자동 스킵" />
              <Item text="자동 발송 설정 패널에서 활성화·요일·기본 인사말 저장 가능" />
              <Note>자동 발송 시 인사말은 DB의 default_editorial 값을 사용합니다. 비워두면 빈 인사말로 발송됩니다.</Note>
            </Section>

            <Section title="👥 수신자 관리">
              <Item text="개별 추가: 이메일 + 이름(선택) 입력 후 추가" />
              <Item text="엑셀 일괄 업로드: email·이름 컬럼이 있는 xlsx 파일 업로드" />
              <Item text="토글로 개별 활성/비활성 전환 가능 — 비활성 수신자에게는 발송되지 않음" />
              <Note>중복 이메일은 자동으로 스킵됩니다.</Note>
            </Section>

            <Section title="✍️ AI 인사말 생성">
              <Item text="페이지 열릴 때 이번 호 뉴스 제목 + Pick 행사명을 백그라운드로 미리 로드" />
              <Item text="'AI로 작성' 클릭 시 실제 이번 호 콘텐츠를 컨텍스트로 넘겨 Gemini가 생성" />
              <Item text="6월·날씨·업계 분위기 등 현재 시점 반영, AI·기술 관점 제외" />
              <Item text="마지막 문장은 항상 'EZ하게 시작해볼까요?' 뉘앙스로 마무리" />
            </Section>

            <Section title="📰 뉴스 기사 말투">
              <Item text="모든 summary_short·content_long·implications 는 합쇼체(~했습니다, ~입니다)로 작성" />
              <Item text="기존 기사 말투 변환: rewrite_summaries_formal.mjs 스크립트 실행" />
              <Item text="새 기사는 generate-article API 프롬프트에서 자동으로 합쇼체 적용" />
            </Section>

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
