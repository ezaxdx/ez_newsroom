"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, X } from "lucide-react";
type Schedule = { id: string; scheduled_at: string; status: string; cursor: number; cancel_requested: boolean; error: string | null; newsletter_issues: { vol_number: number; target_count: number; total_sent: number; total_failed: number } };
export default function NewsletterSchedule({ html, vol, subject, editorial, featured, disabled }: { html: string | null; vol?: number; subject: string; editorial: string; featured?: string[]; disabled: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(""); const [jobs, setJobs] = useState<Schedule[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const kst = new Date(Date.now() + 9 * 3600000);
    if (kst.getUTCHours() > 10 || (kst.getUTCHours() === 10 && kst.getUTCMinutes() >= 29)) kst.setUTCDate(kst.getUTCDate() + 1);
    const initialAt = kst.toISOString().slice(0,10) + "T10:30";
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/admin/newsletter/schedule"); const j = await r.json(); if (!r.ok) throw new Error(j.error); if (alive) { setJobs(j.data ?? []); setAt(previous => previous || initialAt); } } catch (e) { if (alive) setError(e instanceof Error ? e.message : "예약 조회 실패"); } };
    void load(); const timer = setInterval(load, 10000); return () => { alive = false; clearInterval(timer); };
  }, []);
  async function act(id?: string) {
    if (!id && (!html || !vol || !at)) return;
    if (!window.confirm(id ? "예약을 취소하거나 남은 발송을 중지할까요? 이미 전송 중인 최대 5명과 발송 완료 메일은 회수되지 않습니다." : `${at.replace("T", " ")} (한국시간)부터 25명씩 자동 발송합니다. 현재 미리보기·제목·수신 대상을 확정할까요?`)) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/newsletter/schedule", { method: id ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { at: new Date(at + ":00+09:00").toISOString(), html, vol, subject, editorial, featured }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      const refreshed = await fetch("/api/admin/newsletter/schedule"); const data = await refreshed.json(); if (!refreshed.ok) throw new Error(data.error); setJobs(data.data ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "예약 처리 실패"); } finally { setBusy(false); }
  }
  const active = jobs.some(j => ["scheduled","running","attention"].includes(j.status));
  const labels: Record<string,string> = { scheduled: "예약 대기 / 다음 회차 대기", running: "발송 중", completed: "발송 완료", cancelled: "취소·중지", attention: "확인 필요" };
  return <>
    <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog"
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 6,
        border: "1px solid var(--primary)", background: "transparent", color: "var(--primary)",
        fontWeight: 600, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>
      <CalendarClock size={14} /> 예약 발송{active ? " · 진행 중" : ""}
    </button>
    <dialog ref={dialogRef} aria-labelledby="newsletter-schedule-title"
      className="backdrop:bg-black/40"
      style={{ margin: "auto", width: "min(600px, calc(100vw - 32px))", maxHeight: "85dvh", overflowY: "auto",
        padding: 24, border: "1px solid var(--surface-container-highest)", borderRadius: 12,
        background: "var(--surface-container-low)", color: "var(--on-surface)", boxShadow: "0 20px 60px #0003" }}>
    <div className="flex items-center justify-between gap-4 mb-4">
      <h3 id="newsletter-schedule-title" className="font-semibold text-lg">예약 발송 설정</h3>
      <button type="button" aria-label="예약 발송 설정 닫기" onClick={() => dialogRef.current?.close()}
        className="rounded p-2" style={{ cursor: "pointer" }}><X size={20} /></button>
    </div>
    <p className="text-sm mb-3">완성된 미리보기를 저장하고 한국시간 기준으로 발송합니다. 25명씩 약 1분 간격으로 이어서 보내며 창을 닫아도 진행됩니다. 예약 후 편집은 반영되지 않으므로 변경하려면 취소 후 다시 예약하세요.</p>
    <div className="flex flex-wrap gap-3 items-center"><input aria-label="예약 발송 시각 (한국시간)" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className="border rounded px-3 py-2" /><button type="button" disabled={busy || disabled || active || !html || !vol} onClick={() => void act()} className="rounded px-4 py-2 font-semibold disabled:opacity-40" style={{ background: "var(--primary)", color: "white" }}>예약 확정</button></div>
    {!html && <p className="text-sm mt-2">미리보기를 먼저 만들어주세요.</p>}
    {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
    {jobs.map(j => <div key={j.id} className="border-t mt-3 pt-3 text-sm"><b>Vol.{j.newsletter_issues.vol_number} · {labels[j.status]}</b><p>{new Date(j.scheduled_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 한국시간</p><p>성공 {j.newsletter_issues.total_sent} / 대상 {j.newsletter_issues.target_count}명 · 실패 {j.newsletter_issues.total_failed}명</p>{j.error && <p className="text-red-600">{j.error}</p>}{["scheduled","running","attention"].includes(j.status) && <button type="button" disabled={busy || (j.cancel_requested && j.status === "running")} className="border rounded px-3 py-2 mt-2 disabled:opacity-40" onClick={() => void act(j.id)}>{j.cancel_requested && j.status === "running" ? "중지 요청됨" : j.status === "running" ? "남은 발송 중지" : "예약 취소"}</button>}</div>)}
    </dialog>
  </>;
}
