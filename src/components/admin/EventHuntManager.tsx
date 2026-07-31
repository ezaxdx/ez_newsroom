"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import SectionInfoModal from "@/components/admin/SectionInfoModal";

type Settings = { enabled: boolean; title: string; form_url: string | null };
type HuntPopup = { id: string; title: string; hunt_code: string | null; pages: string[]; is_active: boolean };

export default function EventHuntManager({ huntPopups }: { huntPopups: HuntPopup[] }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/event-settings");
        const json = await res.json();
        setSettings(json.data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/event-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "저장 실패"); return; }
      setSettings(json.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 32, padding: "0 10px", borderRadius: 6, fontSize: 13,
    border: "1px solid var(--surface-container-highest)",
    background: "var(--surface-container-low)",
    color: "var(--on-surface)", outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 600,
    color: "var(--on-surface-variant)", marginBottom: 4,
  };

  const active = huntPopups.filter((p) => p.is_active);
  const missingCode = huntPopups.filter((p) => !p.hunt_code?.trim());

  return (
    <div className="p-5 rounded-lg mb-8 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
      <div>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5 flex items-center gap-1.5"
          style={{ color: "var(--on-surface-variant)" }}>
          이벤트 관리 (숨은 그림 찾기)
          <SectionInfoModal title="숨은 그림 찾기 이벤트 안내">
            {[
              {
                n: 1, title: "찾기 코드란",
                body: "팝업에 찾기 코드를 입력하면 그 팝업은 일반 배너가 아니라 찾기 대상이 됩니다. 방문자가 클릭하면 링크로 이동하는 대신 코드를 알려주고 사라집니다.",
              },
              {
                n: 2, title: "당첨 층을 나누는 방법",
                body: "로그인이 없어 사이트가 “누가 몇 개 찾았는지”를 증명할 수 없습니다. 그래서 찾을 때마다 코드를 알려주고, 응모 구글폼에서 찾은 코드를 모두 적게 합니다. 폼 응답에 적힌 코드 개수로 1개·3개·6개 층을 구분하면 됩니다.",
              },
              {
                n: 3, title: "등록 방법",
                body: "위 팝업 목록에서 고양이 수만큼 팝업을 만들고, 각각 노출 페이지·위치를 다르게 준 뒤 찾기 코드를 서로 다르게 입력합니다. 표시 방식은 고정, 위치는 랜덤을 권장합니다.",
              },
              {
                n: 4, title: "이벤트 사용",
                body: "꺼두면 코드가 입력된 팝업은 사이트에 아예 노출되지 않습니다. 준비 중에는 꺼두세요.",
              },
            ].map(({ n, title: t, body }) => (
              <div key={n} style={{ marginBottom: 14 }}>
                <p style={{ margin: "0 0 3px", fontWeight: 700, fontSize: 14, color: "#111" }}>{n}. {t}</p>
                <p style={{ margin: 0, fontWeight: 400, fontSize: 13, color: "#555", lineHeight: 1.65 }}>{body}</p>
              </div>
            ))}
          </SectionInfoModal>
        </p>
        <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
          찾기 코드가 입력된 팝업을 모아 진행률·응모 버튼을 함께 노출합니다
        </p>
      </div>

      {loading || !settings ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--on-surface-variant)" }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> 불러오는 중...
        </div>
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 14px", borderRadius: 8,
            background: settings.enabled ? "color-mix(in srgb, var(--primary) 8%, transparent)" : "var(--surface-container-low)",
            border: `1px solid ${settings.enabled ? "var(--primary)" : "var(--surface-container-highest)"}`,
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
                {settings.enabled ? "이벤트 진행 중" : "이벤트 중지됨 (보류)"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--on-surface-variant)" }}>
                {settings.enabled
                  ? `찾기 대상 ${active.length}마리가 사이트에 노출됩니다`
                  : "켜기 전까지 찾기 대상 팝업은 노출되지 않습니다"}
              </p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              style={{
                padding: "5px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: "1px solid",
                borderColor: settings.enabled ? "var(--primary)" : "var(--surface-container-highest)",
                background: settings.enabled ? "var(--primary)" : "transparent",
                color: settings.enabled ? "#fff" : "var(--on-surface-variant)",
              }}
            >
              {settings.enabled ? "ON" : "OFF"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>이벤트 이름</label>
              <input value={settings.title}
                onChange={(e) => setSettings({ ...settings, title: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>응모 구글폼 주소</label>
              <input value={settings.form_url ?? ""} placeholder="https://forms.gle/..."
                onChange={(e) => setSettings({ ...settings, form_url: e.target.value })} style={inputStyle} />
            </div>
          </div>

          {/* 등록된 찾기 대상 현황 */}
          <div style={{ borderRadius: 8, padding: "12px 14px", background: "var(--surface-container-low)" }}>
            <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700 }}>
              등록된 찾기 대상 {huntPopups.length}개 <span style={{ fontWeight: 400, color: "var(--on-surface-variant)" }}>(사용중 {active.length}개)</span>
            </p>
            {huntPopups.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: "var(--on-surface-variant)" }}>
                아직 없습니다. 위 팝업 목록에서 <b>찾기 코드</b>를 입력해 등록하세요.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {huntPopups.map((p) => (
                  <span key={p.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 10px", borderRadius: 20, fontSize: 12,
                    background: "var(--surface-container-high)",
                    opacity: p.is_active ? 1 : 0.45,
                  }}>
                    <b>{p.hunt_code || "코드없음"}</b>
                    <span style={{ fontSize: 10, color: "var(--on-surface-variant)" }}>{p.title}</span>
                  </span>
                ))}
              </div>
            )}
            {missingCode.length > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#dc2626" }}>
                코드가 비어 있는 항목이 {missingCode.length}개 있습니다. 코드가 없으면 찾기 대상으로 동작하지 않습니다.
              </p>
            )}
          </div>

          {error && <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>{error}</p>}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={save} disabled={saving}
              style={{
                padding: "7px 18px", borderRadius: 6, border: "none",
                background: "var(--primary)", color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1,
              }}>
              {saving ? "저장 중..." : "저장"}
            </button>
            {saved && <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>저장되었습니다</span>}
          </div>
        </>
      )}
    </div>
  );
}
