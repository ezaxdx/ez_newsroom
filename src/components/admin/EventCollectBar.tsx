"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, MoreHorizontal, Loader2, Check, X } from "lucide-react";

// 행사 정보 가져오기 — 버튼 하나로 AKEI·KEOA·쇼알라를 한꺼번에 수집하고, 진행 상황·결과를 한 줄로 보여줌.
// 엑셀 업로드(AKEI)는 자동 수집이 막혔을 때를 위한 보조 기능으로 ⋯ 메뉴 안에 둠.

type ScrapeLog = {
  id: string; created_at: string; ok: boolean;
  showala_scraped: number | null; keoa_scraped: number | null; akei_scraped?: number | null;
  inserted: number | null; updated: number | null; auto_hidden: number | null;
  elapsed_sec: number | null; error: string | null;
  source?: string | null; dropped_count?: number | null;
};

type ImportPreview = {
  new_count: number; merge_count: number; skip_count: number; dropped_count?: number;
  preview_new: { name: string; date: string; venue: string }[];
  preview_merge: { name: string; date: string; fields: string[] }[];
  preview_dropped?: { name: string; reason: string }[];
} | null;

const SOURCES = [
  { key: "akei", label: "AKEI" },
  { key: "keoa", label: "KEOA" },
  { key: "showala", label: "쇼알라" },
] as const;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

// 다음 자동 수집일 — 분기(1·4·7·10월) 1일 09:00 KST
function nextAutoRun(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth();   // 0-based
  const quarters = [0, 3, 6, 9];
  const next = quarters.find((q) => q > m || (q === m && kst.getUTCDate() === 1 && kst.getUTCHours() < 9));
  const year = next === undefined ? y + 1 : y;
  const month = (next ?? 0) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export default function EventCollectBar({ pendingCount, onReloadEvents, onScrapeDone, onLastNew }: {
  pendingCount: number;
  onReloadEvents: () => void;
  onScrapeDone: () => void;
  onLastNew: (n: number | null) => void;
}) {
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [doneSrc, setDoneSrc] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // 수행실적 엑셀 갱신 — 행사로 가져오지 않고 점수 계산용 발주처 목록만 갱신
  type TrackPreview = { total_rows: number; event_rows: number; org_count: number; added_count: number; removed_count: number; top: string[]; added_sample: string[] } | null;
  const [showTrack, setShowTrack] = useState(false);
  const [trackMeta, setTrackMeta] = useState<{ at: string | null; file: string | null } | null>(null);
  const trackFileRef = useRef<HTMLInputElement>(null);
  const [trackRows, setTrackRows] = useState<unknown[][] | null>(null);
  const [trackName, setTrackName] = useState("");
  const [trackPreview, setTrackPreview] = useState<TrackPreview>(null);
  const [trackStatus, setTrackStatus] = useState<"idle" | "parsing" | "ready" | "running" | "done" | "error">("idle");
  const [trackMsg, setTrackMsg] = useState("");

  // 엑셀 가져오기 (보조)
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<unknown[] | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "parsing" | "ready" | "running" | "done" | "error">("idle");
  const [importMsg, setImportMsg] = useState("");

  // 가장 최근 수집 묶음 — 마지막 기록과 30분 이내에 만들어진 기록들 (소스별로 따로 실행되어 기록이 소스마다 생김)
  const lastRun = useMemo(() => {
    if (!logs.length) return null;
    const t0 = Date.parse(logs[0].created_at);
    const batch = logs.filter((l) => t0 - Date.parse(l.created_at) < 30 * 60_000);
    return { at: logs[0].created_at, batch, failed: batch.filter((l) => !l.ok), inserted: batch.reduce((s, l) => s + (l.inserted ?? 0), 0) };
  }, [logs]);

  useEffect(() => { onLastNew(lastRun ? lastRun.inserted : null); }, [lastRun, onLastNew]);

  const loadLogs = useCallback(async (): Promise<ScrapeLog[]> => {
    try {
      const { data } = (await (await fetch("/api/admin/scrape-logs")).json()) as { data?: ScrapeLog[] };
      if (data?.length) setLogs(data);
      return data ?? [];
    } catch { return []; }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = (await (await fetch("/api/admin/scrape-logs")).json()) as { data?: ScrapeLog[] };
        if (alive && data?.length) setLogs(data);
      } catch { /* 무시 */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await (await fetch("/api/admin/track-record")).json();
        if (alive && j.meta) setTrackMeta({ at: j.meta.track_record_at ?? null, file: j.meta.track_record_file ?? null });
      } catch { /* 무시 */ }
    })();
    return () => { alive = false; };
  }, []);

  async function handleTrackFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrackStatus("parsing"); setTrackPreview(null); setTrackMsg(""); setTrackName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      setTrackRows(rows);
      const res = await fetch("/api/admin/track-record", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, file_name: file.name, dry_run: true }),
      });
      const j = await res.json();
      if (!res.ok) { setTrackStatus("error"); setTrackMsg(j.error ?? "분석 실패"); return; }
      setTrackPreview(j); setTrackStatus("ready");
    } catch (err) {
      setTrackStatus("error"); setTrackMsg(err instanceof Error ? err.message : "파일 분석 오류");
    }
  }

  async function applyTrack() {
    if (!trackRows) return;
    setTrackStatus("running");
    try {
      const res = await fetch("/api/admin/track-record", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: trackRows, file_name: trackName, dry_run: false }),
      });
      const j = await res.json();
      if (!res.ok) { setTrackStatus("error"); setTrackMsg(j.error ?? "반영 실패"); return; }
      setTrackMsg(`발주처 ${j.org_count}곳 반영 (신규 ${j.added_count} · 제외 ${j.removed_count})`);
      setTrackMeta({ at: new Date().toISOString(), file: trackName });
      setTrackStatus("done");
    } catch { setTrackStatus("error"); setTrackMsg("반영 실패"); }
  }

  function resetTrack() {
    setTrackRows(null); setTrackPreview(null); setTrackStatus("idle"); setTrackMsg(""); setTrackName("");
    if (trackFileRef.current) trackFileRef.current.value = "";
  }

  async function handleScrape() {
    setStatus("running"); setDoneSrc(new Set()); setMenuOpen(false);
    const prevIds = new Set(logs.map((l) => l.id));
    try {
      const res = await fetch("/api/admin/scrape-events", { method: "POST" });
      if (!res.ok) { setStatus("error"); return; }
      // 소스별로 따로 실행되어 소스마다 기록이 생김 — 3개가 모두 새로 생길 때까지 폴링 (최대 3분)
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const data = await loadLogs();
        const fresh = data.filter((l) => !prevIds.has(l.id));
        const srcDone = new Set(fresh.flatMap((l) => (l.source && l.source !== "all" ? [l.source] : SOURCES.map((s) => s.key))));
        setDoneSrc(srcDone);
        if (srcDone.size >= SOURCES.length) {
          setStatus(fresh.every((l) => l.ok) ? "done" : "error");
          onScrapeDone(); onReloadEvents();
          return;
        }
      }
      setStatus("done"); // 시간 초과 — 기록은 나중에 확인
      onScrapeDone(); onReloadEvents();
    } catch {
      setStatus("error");
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus("parsing"); setImportPreview(null); setImportMsg("");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      setImportRows(rows);
      const res = await fetch("/api/admin/import-exhibitions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, dry_run: true }),
      });
      setImportPreview(await res.json());
      setImportStatus("ready");
    } catch (err) {
      setImportStatus("error");
      setImportMsg(err instanceof Error ? err.message : "파일 파싱 오류");
    }
  }

  async function runImport() {
    if (!importRows) return;
    setImportStatus("running");
    try {
      const res = await fetch("/api/admin/import-exhibitions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: importRows, dry_run: false }),
      });
      const data = await res.json();
      if (data.ok) {
        setImportMsg(`신규 ${data.inserted}건 추가 · ${data.updated}건 보강 · ${data.skipped}건 스킵${data.dropped ? ` · 규칙 제외 ${data.dropped}건` : ""}`);
        setImportStatus("done");
        onReloadEvents();
      } else {
        setImportMsg(data.error ?? "오류 발생"); setImportStatus("error");
      }
    } catch {
      setImportStatus("error"); setImportMsg("실행 실패");
    }
  }

  function resetImport() {
    setImportRows(null); setImportPreview(null); setImportStatus("idle"); setImportMsg("");
    if (importFileRef.current) importFileRef.current.value = "";
  }

  const running = status === "running";
  const muted = { fontSize: "0.75rem", color: "var(--on-surface-variant)" } as const;
  const sub = (b: boolean) => ({ padding: "6px 12px", borderRadius: 8, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", border: "1px solid var(--surface-container-high)", background: b ? "var(--surface-container)" : "transparent", color: "var(--on-surface)" } as const);

  return (
    <div style={{ marginBottom: 16, border: "1px solid var(--surface-container-high)", borderRadius: 12, background: "var(--surface-container-lowest)", padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={muted}>
          {lastRun
            ? <>마지막 수집 {fmtTime(lastRun.at)} · {lastRun.failed.length ? <b style={{ color: "#dc2626" }}>실패 {lastRun.failed.length}건</b> : "실패 없음"} · </>
            : <>수집 기록 없음 · </>}
          다음 자동 수집 {nextAutoRun()}
          {trackMeta?.at ? ` · 수행실적 기준일 ${new Date(trackMeta.at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" })}` : " · 수행실적 미반영"}
        </span>
        <span style={{ display: "flex", gap: 6, position: "relative" }}>
          <button
            onClick={handleScrape}
            disabled={running}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
              border: "none", background: "var(--primary)", color: "#fff", cursor: running ? "wait" : "pointer", opacity: running ? 0.7 : 1,
            }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {running ? "수집 중…" : "행사 정보 가져오기"}
          </button>
          <button aria-label="더보기" onClick={() => setMenuOpen((v) => !v)} style={{ ...sub(menuOpen), padding: "6px 8px", display: "inline-flex", alignItems: "center" }}>
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20, minWidth: 190, padding: 4, borderRadius: 8, background: "var(--surface-container-lowest)", border: "1px solid var(--surface-container-high)", boxShadow: "0 6px 20px rgba(0,0,0,0.12)" }}>
              <button onClick={() => { setShowImport(true); setMenuOpen(false); }} style={{ width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 6, border: "none", background: "transparent", fontSize: "0.78rem", cursor: "pointer", color: "var(--on-surface)" }}>
                AKEI 엑셀로 가져오기 <span style={{ color: "var(--on-surface-variant)", fontSize: "0.68rem" }}>(보조)</span>
              </button>
              <button onClick={() => { setShowTrack(true); setMenuOpen(false); }} style={{ width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 6, border: "none", background: "transparent", fontSize: "0.78rem", cursor: "pointer", color: "var(--on-surface)" }}>
                수행실적 엑셀 갱신 <span style={{ color: "var(--on-surface-variant)", fontSize: "0.68rem" }}>(행사 점수용)</span>
              </button>
            </div>
          )}
        </span>
      </div>

      {(running || status === "done" || status === "error") && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--surface-container-high)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: "0.78rem" }}>
          {running && (
            <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {SOURCES.map((s) => (
                <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: doneSrc.has(s.key) ? "var(--on-surface)" : "var(--on-surface-variant)" }}>
                  {doneSrc.has(s.key) ? <Check size={13} color="#059669" /> : <Loader2 size={13} className="animate-spin" />}
                  {s.label}{doneSrc.has(s.key) ? "" : " 수집 중"}
                </span>
              ))}
            </span>
          )}
          {!running && status === "done" && (
            <span>
              수집 완료 · 신규 <b>{lastRun?.inserted ?? 0}</b> ·{" "}
              {pendingCount > 0
                ? <a href="#event-changes-panel" style={{ color: "var(--primary)", fontWeight: 600 }}>검토 필요 {pendingCount}건 보기 ↓</a>
                : "검토할 항목 없음"}
            </span>
          )}
          {!running && status === "error" && (
            <span style={{ color: "#dc2626" }}>
              <X size={13} style={{ display: "inline", verticalAlign: -2 }} /> 일부 소스 수집에 실패했습니다
              {lastRun?.failed.map((l) => ` · ${l.source ? sourceLabel(l.source) : "전체"}: ${l.error ?? "오류"}`).join("")}
            </span>
          )}
        </div>
      )}

      {showTrack && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--surface-container-high)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <b style={{ fontSize: "0.8rem" }}>수행실적 엑셀 갱신 <span style={{ ...muted, fontWeight: 500 }}>(행사 점수용)</span></b>
            <button onClick={() => { setShowTrack(false); resetTrack(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }} aria-label="닫기"><X size={16} /></button>
          </div>
          <p style={{ ...muted, margin: "0 0 10px", lineHeight: 1.5 }}>
            수행실적 엑셀(Ezpmp_수행실적리스트_날짜.xlsx)을 올리면 발주처·주최·주관 기관만 뽑아 행사 점수에 반영합니다. 행사로 등록하거나 화면에 공개하지 않으며, 분기마다 최신 파일로 올려 주세요.
            {trackMeta?.at && <> 현재 반영본: {trackMeta.file ?? "-"} ({new Date(trackMeta.at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })})</>}
          </p>
          {trackStatus === "idle" && (
            <label style={{ ...sub(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
              엑셀 선택
              <input ref={trackFileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleTrackFile} />
            </label>
          )}
          {trackStatus === "parsing" && <p style={{ ...muted, margin: 0 }}>파일 분석 중…</p>}
          {trackStatus === "ready" && trackPreview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface-container)", fontSize: "0.75rem", lineHeight: 1.7 }}>
                행사형 수행실적 <b>{trackPreview.event_rows}건</b> (전체 {trackPreview.total_rows}건 중 놀이터·플랫폼·연구용역 제외) · 인식한 기관 <b>{trackPreview.org_count}곳</b>
                <br />이전 반영본 대비 신규 <b style={{ color: "#10b981" }}>{trackPreview.added_count}곳</b> · 빠짐 <b style={{ color: "#d97706" }}>{trackPreview.removed_count}곳</b>
                <br /><span style={{ color: "var(--on-surface-variant)" }}>상위: {trackPreview.top.join(", ")}</span>
                {trackPreview.added_sample.length > 0 && <><br /><span style={{ color: "var(--on-surface-variant)" }}>신규 예: {trackPreview.added_sample.join(", ")}</span></>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={resetTrack} style={sub(false)}>취소</button>
                <button onClick={applyTrack} style={{ ...sub(false), background: "var(--primary)", color: "#fff", border: "none" }}>점수에 반영</button>
              </div>
            </div>
          )}
          {trackStatus === "running" && <p style={{ ...muted, margin: 0 }}>반영 중…</p>}
          {trackStatus === "done" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#059669", fontWeight: 600 }}>{trackMsg}</p>
              <button onClick={resetTrack} style={{ ...sub(false), alignSelf: "flex-start" }}>다른 파일 올리기</button>
            </div>
          )}
          {trackStatus === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#dc2626" }}>{trackMsg}</p>
              <button onClick={resetTrack} style={{ ...sub(false), alignSelf: "flex-start" }}>다시 시도</button>
            </div>
          )}
        </div>
      )}

      {showImport && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--surface-container-high)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <b style={{ fontSize: "0.8rem" }}>AKEI 엑셀 가져오기 <span style={{ ...muted, fontWeight: 500 }}>(보조)</span></b>
            <button onClick={() => { setShowImport(false); resetImport(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }} aria-label="닫기"><X size={16} /></button>
          </div>
          <p style={{ ...muted, margin: "0 0 10px", lineHeight: 1.5 }}>
            AKEI는 자동 수집됩니다. 자동 수집이 막혔을 때만 크롤러 엑셀을 올리세요. 자동 수집과 같은 중복 판정·비공개 규칙을 적용합니다.
          </p>

          {importStatus === "idle" && (
            <label style={{ ...sub(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
              엑셀 선택
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileChange} />
            </label>
          )}
          {importStatus === "parsing" && <p style={{ ...muted, margin: 0 }}>파일 분석 중…</p>}

          {importStatus === "ready" && importPreview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface-container)", fontSize: "0.75rem" }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>신규 <b style={{ color: "#10b981" }}>{importPreview.new_count}건</b></span>
                  <span>보강 <b style={{ color: "#f59e0b" }}>{importPreview.merge_count}건</b></span>
                  <span>스킵 <b style={{ color: "#94a3b8" }}>{importPreview.skip_count}건</b></span>
                  {!!importPreview.dropped_count && <span>규칙 제외 <b style={{ color: "#d97706" }}>{importPreview.dropped_count}건</b></span>}
                </div>
                {importPreview.preview_new.slice(0, 5).map((r, i) => (
                  <p key={i} style={{ margin: "3px 0 0", fontSize: "0.68rem", color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>신규 · {r.name} · {r.date}</p>
                ))}
                {!!importPreview.preview_dropped?.length && (
                  <p style={{ margin: "6px 0 0", fontSize: "0.65rem", color: "var(--on-surface-variant)" }}>
                    제외 예: {importPreview.preview_dropped.slice(0, 3).map((d) => `${d.name}(${d.reason})`).join(", ")}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={resetImport} style={sub(false)}>취소</button>
                <button onClick={runImport} style={{ ...sub(false), background: "var(--primary)", color: "#fff", border: "none" }}>가져오기 실행</button>
              </div>
            </div>
          )}

          {importStatus === "running" && <p style={{ ...muted, margin: 0 }}>가져오는 중…</p>}
          {importStatus === "done" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#059669", fontWeight: 600 }}>{importMsg}</p>
              <button onClick={resetImport} style={{ ...sub(false), alignSelf: "flex-start" }}>다시 가져오기</button>
            </div>
          )}
          {importStatus === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#dc2626" }}>{importMsg}</p>
              <button onClick={resetImport} style={{ ...sub(false), alignSelf: "flex-start" }}>다시 시도</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function sourceLabel(s: string) {
  return SOURCES.find((x) => x.key === s)?.label ?? s;
}
