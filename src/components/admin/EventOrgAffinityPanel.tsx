"use client";

import { useEffect, useState } from "react";

// 행사 점수 — 주최사 가산 목록 관리 + 점수 미리보기
//  동종 업계 / 장소 운영사 / PEO(후순위): 직접 추가·삭제
//  수행실적 발주처: 엑셀로 자동 갱신(수집 줄 ⋯ 메뉴) — 여기서는 요약만 보여줌

type Org = { id: string; org_key: string; org_name: string; tier: "client" | "peer" | "venue" | "peo"; source: string; hit_count: number; last_year: number | null };
type Preview = { id: string; name: string; start_date: string; organizer: string | null; pick: boolean; total: number; keyword: number; org: number; orgLabel: string | null; client: number; category: number; proximity: number };

const TIERS = [
  { key: "peer", title: "동종 업계", desc: "전시·컨벤션 주최사, PCO — 업계 동향", tone: "#7c3aed", placeholder: "예: 인터컴" },
  { key: "venue", title: "장소 운영사", desc: "컨벤션센터가 직접 주최하는 행사", tone: "#059669", placeholder: "예: 코엑스" },
  { key: "peo", title: "PEO 계열 (후순위)", desc: "동종 업계보다 낮게 가산", tone: "#d97706", placeholder: "예: 동아전람" },
] as const;

export default function EventOrgAffinityPanel() {
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    (async () => {
      try {
        const json = await (await fetch("/api/admin/event-orgs")).json();
        if (!alive) return;
        if (json.unavailable) setUnavailable(true); else setOrgs(json.data ?? []);
      } catch { /* 무시 */ }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [open, loaded]);

  async function add(tier: string) {
    const name = (draft[tier] ?? "").trim();
    if (!name) return;
    setError(null);
    const res = await fetch("/api/admin/event-orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_name: name, tier }) });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "추가 실패"); return; }
    setOrgs((prev) => [...prev, json.data]);
    setDraft((d) => ({ ...d, [tier]: "" }));
    setPreview(null);
  }

  async function remove(id: string) {
    await fetch("/api/admin/event-orgs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setOrgs((prev) => prev.filter((o) => o.id !== id));
    setPreview(null);
  }

  async function runPreview() {
    setPreviewing(true);
    try { setPreview((await (await fetch("/api/admin/event-scores")).json()).rows ?? []); }
    finally { setPreviewing(false); }
  }

  const clients = orgs.filter((o) => o.tier === "client").sort((a, b) => b.hit_count - a.hit_count);

  return (
    <div style={{ marginBottom: 16, border: "1px solid var(--surface-container-high)", borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--surface-container)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--on-surface)" }}
      >
        <span>⭐ 행사 점수 — 주최사 가산 목록</span>
        <span style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 16px" }}>
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--on-surface-variant)", lineHeight: 1.6 }}>
            뉴스레터 추천 행사와 홈·행사 캘린더의 자동 이즈픽은 점수 순으로 채워집니다. 아래 주최사가 여는 행사는 가산을 받습니다.
            공공·기관 주최, 동종 업계, 장소 운영사, PEO가 겹치면 가장 큰 쪽 하나만 적용되고, 수행실적 발주처는 별도로 더해집니다.
          </p>
          {unavailable && <p style={{ margin: "0 0 10px", fontSize: 12, color: "#d97706" }}>목록을 쓰려면 <b>08_event_scoring.sql</b>을 실행해야 합니다. (실행 전에는 기본 목록으로 점수가 계산됩니다)</p>}
          {error && <p style={{ margin: "0 0 10px", fontSize: 12, color: "#dc2626" }}>⚠️ {error}</p>}

          {!unavailable && TIERS.map((t) => (
            <div key={t.key} style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: t.tone }}>
                {t.title} <span style={{ fontWeight: 500, color: "var(--on-surface-variant)" }}>· {t.desc}</span>
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                {orgs.filter((o) => o.tier === t.key).map((o) => (
                  <span key={o.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: "var(--surface-container-high)", fontSize: 12, color: "var(--on-surface)" }}>
                    {o.org_name}
                    <button onClick={() => remove(o.id)} aria-label={`${o.org_name} 삭제`} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={draft[t.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && add(t.key)} placeholder={t.placeholder}
                  style={{ width: 200, height: 28, padding: "0 8px", borderRadius: 6, fontSize: 12, border: "1px solid var(--surface-container-highest)", background: "var(--surface-container-low)", color: "var(--on-surface)", outline: "none" }}
                />
                <button onClick={() => add(t.key)} disabled={!(draft[t.key] ?? "").trim()} style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "none", background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: (draft[t.key] ?? "").trim() ? 1 : 0.5 }}>추가</button>
              </div>
            </div>
          ))}

          {!unavailable && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#2563eb" }}>
                수행실적 발주처 <span style={{ fontWeight: 500, color: "var(--on-surface-variant)" }}>· {clients.length}곳 · 엑셀로 갱신 (행사 정보 가져오기 줄의 ⋯ 메뉴)</span>
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--on-surface-variant)", lineHeight: 1.6 }}>
                {clients.length === 0 ? "아직 올린 수행실적이 없습니다." : clients.slice(0, 12).map((o) => `${o.org_name}(${o.hit_count})`).join(", ") + (clients.length > 12 ? ` 외 ${clients.length - 12}곳` : "")}
              </p>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--surface-container-high)", paddingTop: 12 }}>
            <button onClick={runPreview} disabled={previewing} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--surface-container-highest)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: previewing ? "wait" : "pointer", color: "var(--on-surface)" }}>
              {previewing ? "계산 중…" : "점수 상위 행사 미리보기 (30일 이내)"}
            </button>
            {preview && (
              <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                {preview.length === 0 && <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>30일 이내 공개 행사가 없습니다.</span>}
                {preview.map((r, i) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 8, alignItems: "baseline", padding: "5px 0", borderTop: i ? "1px solid var(--surface-container-high)" : "none", fontSize: 12 }}>
                    <span style={{ color: "var(--on-surface-variant)" }}>{i + 1}</span>
                    <span style={{ minWidth: 0 }}>
                      <b style={{ fontWeight: 600 }}>{r.pick ? "⭐ " : ""}{r.name}</b>
                      <span style={{ display: "block", fontSize: 10.5, color: "var(--on-surface-variant)" }}>
                        {r.start_date.slice(5).replace("-", "/")} · 키워드 {r.keyword} · 주최 {r.org}{r.orgLabel ? `(${r.orgLabel})` : ""} · 발주처 {r.client} · 분류 {r.category} · 근접 {r.proximity}
                      </span>
                    </span>
                    <b style={{ color: "var(--primary)" }}>{r.total}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
