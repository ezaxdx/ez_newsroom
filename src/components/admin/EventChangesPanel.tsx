"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// 행사 수집 변경 내역 — 수집이 끝나면 관리자가 확인할 것만 모아서 보여주는 검토 대기열
// (일정 변경 의심 · 동일 행사 의심 · 동시개최 묶음 · 값 변경 · 소스에서 사라짐 · 신규) + 자동 제외 내역 + 처리 이력(되돌리기)

type EventLite = {
  id: string; event_name: string; venue: string; start_date: string; end_date: string | null;
  organizer: string | null; website: string | null; is_published: boolean; source: string | null;
};
type Kind = "new" | "date_suspect" | "duplicate_suspect" | "concurrent" | "field_change" | "missing";
type Change = {
  id: string; created_at: string; resolved_at: string | null; kind: Kind;
  status: string; resolution: string | null; event_id: string | null; source: string | null;
  payload: Record<string, unknown>; event: EventLite | null;
};
type Candidate = {
  event_name: string; start_date: string; end_date: string | null; venue: string; organizer: string | null; source: string;
  [k: string]: unknown;
};
type DroppedItem = { name: string; date: string; reason: string; source: string; c?: Candidate };
type ScrapeLogLite = { id: string; created_at: string; source?: string | null; dropped?: DroppedItem[] | null };
type Tab = Kind | "dropped" | "history";

const SOURCE_LABEL: Record<string, string> = { akei: "AKEI", keoa: "KEOA", showala: "쇼알라", manual: "수동", auto: "자동" };
const FIELD_LABEL: Record<string, string> = { end_date: "종료일", organizer: "주최", website: "홈페이지" };
const TAB_LABEL: Record<Tab, string> = {
  date_suspect: "일정 변경 의심", duplicate_suspect: "동일 행사 의심", concurrent: "동시개최 묶음",
  field_change: "값 변경", missing: "소스에서 사라짐", new: "신규", dropped: "자동 제외 내역", history: "처리 내역",
};
const TAB_ORDER: Tab[] = ["date_suspect", "duplicate_suspect", "concurrent", "field_change", "missing", "new", "dropped", "history"];
const PENDING_KINDS: Kind[] = ["date_suspect", "duplicate_suspect", "concurrent", "field_change", "missing", "new"];

const fmtRange = (s?: string | null, e?: string | null) => (s ? `${s.slice(2).replace(/-/g, ".")}${e && e !== s ? ` ~ ${e.slice(2).replace(/-/g, ".")}` : ""}` : "-");
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "-");

export default function EventChangesPanel({ onPatch, onAdd, onCount, refreshKey = 0 }: {
  onPatch: (id: string, fields: Record<string, unknown>) => void;
  onAdd: (row: Record<string, unknown>) => void;
  onCount?: (pending: number) => void;
  refreshKey?: number;
}) {
  const [pending, setPending] = useState<Change[]>([]);
  const [history, setHistory] = useState<Change[]>([]);
  const [dropped, setDropped] = useState<(DroppedItem & { key: string })[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parentPick, setParentPick] = useState<Record<string, string>>({});   // 동시개최 묶음별로 고른 대표 행사
  const [allowed, setAllowed] = useState<Set<string>>(new Set());

  const apply = useCallback((json: { pending?: Change[]; history?: Change[]; unavailable?: boolean }, first: boolean) => {
    const p = json.pending ?? [];
    setPending(p);
    setHistory(json.history ?? []);
    setUnavailable(!!json.unavailable);
    setLoaded(true);
    onCount?.(p.length);
    if (first && p.length > 0) {
      // 처리가 필요한 항목이 있는 탭부터 보여줌 (신규는 확인만 하면 되므로 뒤로)
      setTab(PENDING_KINDS.find((k) => p.some((x) => x.kind === k)) ?? "new");
      setOpen(true);
    }
  }, [onCount]);

  const load = useCallback(async () => {
    try { apply(await (await fetch("/api/admin/event-changes")).json(), false); } catch { /* 무시 */ }
  }, [apply]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const json = await (await fetch("/api/admin/event-changes")).json();
        if (alive) apply(json, true);
      } catch { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [apply]);

  // 수집이 끝나 새로 불러와야 할 때 (부모가 refreshKey 를 올림)
  useEffect(() => {
    if (refreshKey === 0) return;
    let alive = true;
    (async () => {
      try {
        const json = await (await fetch("/api/admin/event-changes")).json();
        if (alive) { apply(json, false); setDropped(null); }
      } catch { /* 무시 */ }
    })();
    return () => { alive = false; };
  }, [refreshKey, apply]);

  // 자동 제외 내역은 용량이 커서 탭을 열 때 한 번만 불러옴 — 소스별 가장 최근 기록 기준
  useEffect(() => {
    if (tab !== "dropped" || dropped !== null) return;
    let alive = true;
    (async () => {
      try {
        const { data } = (await (await fetch("/api/admin/scrape-logs?dropped=1")).json()) as { data?: ScrapeLogLite[] };
        const seen = new Set<string>(); const out: (DroppedItem & { key: string })[] = [];
        for (const l of data ?? []) {
          const s = l.source ?? "all";
          if (seen.has(s)) continue;
          seen.add(s);
          (l.dropped ?? []).forEach((d, i) => out.push({ ...d, key: `${l.id}-${i}` }));
        }
        if (alive) setDropped(out);
      } catch { if (alive) setDropped([]); }
    })();
    return () => { alive = false; };
  }, [tab, dropped]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of pending) c[p.kind] = (c[p.kind] ?? 0) + 1;
    return c;
  }, [pending]);
  const total = pending.length;

  async function post(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey); setError(null);
    try {
      const res = await fetch("/api/admin/event-changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "처리 실패"); return false; }
      if (json.patch) onPatch(json.patch.id, json.patch.fields);
      for (const p of json.patches ?? []) onPatch(p.id, p.fields);
      if (json.added) onAdd(json.added);
      await load();
      return true;
    } finally { setBusy(null); }
  }
  const act = (id: string, action: string, extra: Record<string, unknown> = {}) => post({ id, action, ...extra }, id);

  async function ackAllNew() {
    if (!confirm(`신규 ${counts.new}건을 모두 확인 처리할까요? (행사는 그대로 공개 상태로 남습니다)`)) return;
    await post({ action: "ack_all_new" }, "all");
  }

  async function allowDropped(d: DroppedItem & { key: string }) {
    if (!d.c) { setError("이 항목은 후보 정보가 없어 바로 등록할 수 없습니다. 다음 수집 때 다시 확인하세요."); return; }
    setBusy(d.key); setError(null);
    try {
      const res = await fetch("/api/admin/event-exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate: d.c }) });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "등록 실패"); return; }
      if (json.added) onAdd(json.added);
      setAllowed((prev) => new Set(prev).add(d.key));
    } finally { setBusy(null); }
  }

  if (!loaded) return null;
  if (unavailable) {
    return (
      <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--surface-container-high)", fontSize: "0.75rem", color: "var(--on-surface-variant)" }}>
        수집 변경 내역을 쓰려면 <b>06_event_changes.sql</b>을 실행해야 합니다.
      </div>
    );
  }

  const btn = (label: string, onClick: () => void, tone: "primary" | "plain" | "danger", disabled = false) => {
    const color = tone === "primary" ? "#fff" : tone === "danger" ? "#dc2626" : "var(--on-surface)";
    const bg = tone === "primary" ? "var(--primary)" : tone === "danger" ? "#fee2e2" : "var(--surface-container-high)";
    return (
      <button key={label} onClick={onClick} disabled={disabled} style={{
        padding: "5px 11px", borderRadius: 6, border: "none", background: bg, color, fontSize: "0.72rem", fontWeight: 600,
        cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
      }}>{label}</button>
    );
  };
  const chip = (text: string, color: string) => (
    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: `${color}18`, color, whiteSpace: "nowrap" }}>{text}</span>
  );
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-container-low)", border: "1px solid var(--surface-container-high)" } as const;
  const note = (text: React.ReactNode) => <p style={{ margin: "0 0 8px", fontSize: "0.7rem", color: "var(--on-surface-variant)", lineHeight: 1.5 }}>{text}</p>;

  const list = pending.filter((p) => p.kind === tab);

  return (
    <div id="event-changes-panel" style={{ marginBottom: 16, border: `1px solid ${total ? "var(--primary)" : "var(--surface-container-high)"}`, borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--surface-container)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--on-surface)" }}
      >
        <span>
          🔔 수집 변경 내역{" "}
          {total > 0
            ? <span style={{ color: "var(--primary)" }}>검토 대기 {total}건</span>
            : <span style={{ color: "var(--on-surface-variant)", fontWeight: 500 }}>검토할 항목 없음</span>}
        </span>
        <span style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {TAB_ORDER.map((k) => {
              const n = k === "history" ? history.length : k === "dropped" ? 0 : (counts[k] ?? 0);
              const active = tab === k;
              return (
                <button key={k} onClick={() => setTab(k)} style={{
                  padding: "5px 12px", borderRadius: 20, fontSize: "0.73rem", fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${active ? "var(--primary)" : "var(--surface-container-high)"}`,
                  background: active ? "var(--primary)" : "transparent", color: active ? "#fff" : "var(--on-surface-variant)",
                }}>{TAB_LABEL[k]} {n > 0 && <b>{n}</b>}</button>
              );
            })}
          </div>

          {error && <p style={{ margin: "0 0 8px", fontSize: "0.73rem", color: "#dc2626" }}>⚠️ {error}</p>}

          {tab === "date_suspect" && note(<>이름이 거의 같은데 시작일이 다른 행사입니다. <b>일정 변경</b>은 기존 행사의 일정만 새 값으로 바꾸고(공개 여부·이즈픽·연결 기사 유지), <b>타 행사</b>는 새로 등록하며 다시 묻지 않습니다.</>)}
          {tab === "duplicate_suspect" && note(<>같은 날 같은 주최·장소에 이름이 비슷한 행사가 있습니다. <b>동일 행사</b>는 새로 등록하지 않고 기존 행사의 빈 항목만 채우고, <b>타 행사</b>는 새로 등록하며 다시 묻지 않습니다.</>)}
          {tab === "concurrent" && note(<>같은 주최가 같은 날짜·장소에서 연 행사들입니다. 대표 행사를 고르면 나머지는 <b>동시개최</b>로 연결되어 목록에서 접히고 뉴스레터에서 제외됩니다. 한 번 묶은 그룹에 새로 들어오는 같은 조건의 행사는 자동 연결됩니다.</>)}
          {tab === "field_change" && note("이미 값이 있는 항목이 소스와 다를 때만 나옵니다. 자동으로 덮어쓰지 않습니다.")}
          {tab === "missing" && note("이전 수집에서 확인됐지만 이번 수집 목록에는 없는 행사입니다. 취소·삭제됐을 수 있고, 다른 소스에는 아직 있을 수 있습니다.")}
          {tab === "dropped" && note(<>비공개 규칙에 걸려 이번 수집에서 등록되지 않은 행사입니다(소스별 최신 수집 기준). 잘못 걸린 행사는 <b>제외하지 않기</b>를 누르면 바로 공개로 등록하고, 이후 수집에서도 규칙에 걸리지 않습니다.</>)}
          {tab === "new" && counts.new > 0 && <div style={{ marginBottom: 8 }}>{btn(`전체 확인 (${counts.new})`, ackAllNew, "plain", busy === "all")}</div>}

          <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {PENDING_KINDS.includes(tab as Kind) && list.length === 0 && <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>대기 중인 항목이 없습니다.</span>}

            {PENDING_KINDS.includes(tab as Kind) && list.map((c) => {
              const e = c.event;
              const name = e?.event_name ?? "(삭제된 행사)";
              const src = SOURCE_LABEL[c.source ?? ""] ?? c.source ?? "";
              const b = busy === c.id;

              if (c.kind === "concurrent") {
                const members = (c.payload.members ?? []) as { id: string; name: string }[];
                const picked = parentPick[c.id];
                return (
                  <div key={c.id} style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
                      {fmtRange(String(c.payload.start_date ?? ""), String(c.payload.end_date ?? ""))} · {String(c.payload.venue ?? "")} · {String(c.payload.organizer ?? "")} — 대표 행사를 고르세요
                    </div>
                    {members.map((m) => (
                      <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.76rem", cursor: "pointer" }}>
                        <input type="radio" name={`parent-${c.id}`} checked={picked === m.id} onChange={() => setParentPick((p) => ({ ...p, [c.id]: m.id }))} />
                        {m.name}
                      </label>
                    ))}
                    <div style={{ display: "flex", gap: 6 }}>
                      {btn(`묶기 (${members.length}건)`, () => { if (!picked) { setError("대표 행사를 먼저 선택하세요"); return; } void act(c.id, "group", { parent_id: picked }); }, "primary", b)}
                      {btn("각각 별개 행사", () => act(c.id, "separate"), "plain", b)}
                    </div>
                  </div>
                );
              }

              return (
                <div key={c.id} style={rowStyle}>
                  <div style={{ minWidth: 0, fontSize: "0.76rem", lineHeight: 1.55 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {chip(src, "#2563eb")}
                      <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</b>
                    </div>
                    {c.kind === "new" && <div style={{ color: "var(--on-surface-variant)" }}>{fmtRange(e?.start_date, e?.end_date)} · {e?.venue}{!e?.is_published ? " · 비공개" : ""}</div>}
                    {c.kind === "date_suspect" && (() => {
                      const cand = c.payload.candidate as Candidate;
                      const old = c.payload.old as { start_date: string; end_date: string | null };
                      return (
                        <div style={{ color: "var(--on-surface-variant)" }}>
                          기존 {fmtRange(old.start_date, old.end_date)} → 소스 <b style={{ color: "#d97706" }}>{fmtRange(cand.start_date, cand.end_date)}</b>
                          {cand.event_name !== name && <span> (소스 표기: {cand.event_name})</span>}
                        </div>
                      );
                    })()}
                    {c.kind === "duplicate_suspect" && (() => {
                      const cand = c.payload.candidate as Candidate;
                      return (
                        <div style={{ color: "var(--on-surface-variant)" }}>
                          {fmtRange(e?.start_date, e?.end_date)} · 소스 표기 <b style={{ color: "#d97706" }}>{cand.event_name}</b>
                          {cand.organizer ? ` · ${cand.organizer}` : ""}
                        </div>
                      );
                    })()}
                    {c.kind === "field_change" && (
                      <div style={{ color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {FIELD_LABEL[String(c.payload.field)] ?? String(c.payload.field)}: {String(c.payload.old)} → <b style={{ color: "#d97706" }}>{String(c.payload.new)}</b>
                      </div>
                    )}
                    {c.kind === "missing" && <div style={{ color: "var(--on-surface-variant)" }}>{fmtRange(e?.start_date, e?.end_date)} · {src}에서 마지막 확인 {fmtDay(String(c.payload.last_seen ?? ""))}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {c.kind === "new" && <>{btn("확인", () => act(c.id, "ack"), "plain", b)}{btn("비공개", () => act(c.id, "hide"), "danger", b)}</>}
                    {c.kind === "date_suspect" && <>{btn("일정 변경", () => act(c.id, "date_changed"), "primary", b)}{btn("타 행사", () => act(c.id, "separate"), "plain", b)}</>}
                    {c.kind === "duplicate_suspect" && <>{btn("동일 행사", () => act(c.id, "same"), "primary", b)}{btn("타 행사", () => act(c.id, "other"), "plain", b)}</>}
                    {c.kind === "field_change" && <>{btn("반영", () => act(c.id, "apply"), "primary", b)}{btn("유지", () => act(c.id, "dismiss"), "plain", b)}</>}
                    {c.kind === "missing" && <>{btn("비공개 처리", () => act(c.id, "hide"), "danger", b)}{btn("유지", () => act(c.id, "keep"), "plain", b)}</>}
                  </div>
                </div>
              );
            })}

            {tab === "dropped" && dropped === null && <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>불러오는 중…</span>}
            {tab === "dropped" && dropped?.length === 0 && <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>최근 수집에서 규칙으로 제외된 행사가 없습니다.</span>}
            {tab === "dropped" && dropped?.map((d) => (
              <div key={d.key} style={rowStyle}>
                <div style={{ minWidth: 0, fontSize: "0.76rem", lineHeight: 1.55 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {chip(SOURCE_LABEL[d.source] ?? d.source, "#2563eb")}
                    <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</b>
                  </div>
                  <div style={{ color: "var(--on-surface-variant)" }}>{d.date} · 걸린 규칙 <span style={{ color: "#d97706", fontWeight: 600 }}>{d.reason}</span></div>
                </div>
                {allowed.has(d.key)
                  ? <span style={{ fontSize: "0.72rem", color: "#059669", fontWeight: 600 }}>등록됨</span>
                  : btn("제외하지 않기", () => allowDropped(d), "plain", busy === d.key)}
              </div>
            ))}

            {tab === "history" && history.length === 0 && <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>처리 내역이 없습니다.</span>}
            {tab === "history" && history.map((c) => {
              const name = c.event?.event_name ?? (c.kind === "concurrent" ? `동시개최 ${(c.payload.members as unknown[] | undefined)?.length ?? 0}건` : "(삭제된 행사)");
              let what = "";
              if (c.kind === "date_suspect") {
                const cand = c.payload.candidate as Candidate;
                const old = c.payload.old as { start_date: string; end_date: string | null };
                what = `일정 ${fmtRange(old.start_date, old.end_date)} → ${fmtRange(cand.start_date, cand.end_date)}`;
              } else if (c.kind === "field_change") {
                what = `${FIELD_LABEL[String(c.payload.field)] ?? String(c.payload.field)}: ${String(c.payload.old)} → ${String(c.payload.new)}`;
              } else if (c.kind === "concurrent") {
                what = "동시개최로 묶음";
              }
              const canRevert = c.status === "applied" && (c.kind === "field_change" || c.kind === "concurrent" || c.resolution === "date_changed");
              return (
                <div key={c.id} style={{ ...rowStyle, padding: "7px 10px", fontSize: "0.74rem" }}>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {chip(c.status === "reverted" ? "되돌림" : "반영", c.status === "reverted" ? "#64748b" : "#059669")} <b>{name}</b>
                    <span style={{ color: "var(--on-surface-variant)" }}> · {what} · {fmtDay(c.resolved_at ?? undefined)}</span>
                  </div>
                  {canRevert && btn("되돌리기", () => act(c.id, "revert"), "plain", busy === c.id)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
