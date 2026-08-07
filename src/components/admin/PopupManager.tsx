"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus } from "lucide-react";
import SectionInfoModal from "@/components/admin/SectionInfoModal";
import { POPUP_PAGES } from "@/lib/popup";
import EventHuntManager from "@/components/admin/EventHuntManager";
import { EFFECT_LABELS, EFFECT_KEYFRAMES, EffectOverlay } from "@/components/newsroom/PopupBanner";

type Popup = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  image_url: string | null;
  link_url: string | null;
  content: string | null;
  content_overrides: { from: string; to: string; text: string }[] | null;
  is_active: boolean;
  display_type: string;
  position: string;
  pages: string[];
  random_page: boolean;
  hunt_code: string | null;
  size_px: number | null;
  pos_x: number | null;
  pos_y: number | null;
  effect: string | null;
  created_at: string;
};

type FormState = {
  title: string;
  start_date: string;
  end_date: string;
  image_url: string;
  link_url: string;
  content: string;
  content_overrides: { from: string; to: string; text: string }[];
  is_active: boolean;
  display_type: string;
  position: string;
  pages: string[];
  random_page: boolean;
  hunt_code: string;
  size_px: number;
  pos_x: number;
  pos_y: number;
  effect: string;
};

// 표시 방식별 사이즈 슬라이더 범위/기본값 — API의 SIZE_RANGE와 동일하게 유지
const SIZE_RANGE: Record<string, { min: number; max: number; default: number }> = {
  floating: { min: 60, max: 400, default: 150 },
  modal: { min: 240, max: 640, default: 420 },
};

const EMPTY_FORM: FormState = {
  title: "", start_date: "", end_date: "",
  image_url: "", link_url: "", content: "", content_overrides: [], is_active: true,
  display_type: "floating", position: "bottom-right",
  pages: ["home"], random_page: false, hunt_code: "",
  size_px: SIZE_RANGE.floating.default,
  pos_x: 90, pos_y: 90,
  effect: "none",
};

// 프리셋 위치("top-left" 등)를 미리보기 화면 안 대략적인 %로 변환 — 마커 표시용
const PRESET_PCT: Record<string, { x: number; y: number }> = {
  "top-left": { x: 8, y: 12 }, "top-center": { x: 50, y: 12 }, "top-right": { x: 92, y: 12 },
  "middle-left": { x: 8, y: 50 }, "middle-center": { x: 50, y: 50 }, "middle-right": { x: 92, y: 50 },
  "bottom-left": { x: 8, y: 88 }, "bottom-center": { x: 50, y: 88 }, "bottom-right": { x: 92, y: 88 },
};

const todayKST = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
// 게시기간(start_date/end_date)은 timestamptz — 목록 표시는 KST 날짜+시간으로
function fmtDateTime(iso: string): string {
  if (!iso) return "";
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${kst.slice(0, 10).replaceAll("-", ".")} ${kst.slice(11, 16)}`;
}
// timestamptz(UTC ISO) → <input type="datetime-local"> 값(KST 벽시계 기준 "YYYY-MM-DDTHH:mm")
function toDatetimeLocalKST(iso: string): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
// datetime-local 값("YYYY-MM-DDTHH:mm", KST 벽시계 기준) → timestamptz로 저장할 ISO(+09:00 오프셋 명시)
function fromDatetimeLocalKST(local: string): string {
  return local ? `${local}:00+09:00` : local;
}
// timestamptz → 날짜 필터 비교용 KST 날짜만(YYYY-MM-DD)
function kstDateOnly(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
// 오늘로부터 정확히 한 달 뒤(YYYY-MM-DD, KST) — 날짜 필터 기본 종료일
function oneMonthFromTodayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const ROW_KO: Record<string, string> = { top: "위", middle: "가운데", bottom: "아래" };
const COL_KO: Record<string, string> = { left: "왼쪽", center: "가운데", right: "오른쪽" };
function pageLabel(key: string) {
  return POPUP_PAGES.find((p) => p.key === key)?.label ?? key;
}
// 미리보기에서 배경으로 띄울 실제 페이지 — 노출 페이지 중 첫 번째 선택 기준
const PREVIEW_PAGE_URL: Record<string, string> = {
  home: "/", category: "/category/mice", events: "/events", archive: "/newsletter/archive",
};

// 실제 노출 로직(PopupBanner)과 동일한 위치 계산 — 저장 전 미리보기용
function resolvePreviewPlace(position: string, posX: number, posY: number, margin: number, topOffset: number): React.CSSProperties {
  if (position === "custom") {
    return { top: `${posY}%`, left: `${posX}%`, transform: "translate(-50%, -50%)" };
  }
  if (position === "random") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const [row = "bottom", col = "right"] = position.split("-");
  const translate = [
    row === "middle" ? "translateY(-50%)" : "",
    col === "center" ? "translateX(-50%)" : "",
  ].filter(Boolean).join(" ");
  return {
    ...(row === "top" ? { top: topOffset } : row === "middle" ? { top: "50%" } : { bottom: margin }),
    ...(col === "left" ? { left: margin } : col === "center" ? { left: "50%" } : { right: margin }),
    ...(translate ? { transform: translate } : {}),
  };
}

function positionLabel(pos: string) {
  if (pos === "random") return "랜덤";
  if (pos === "custom") return "직접 지정";
  const [row, col] = pos.split("-");
  return `${COL_KO[col] ?? ""} ${ROW_KO[row] ?? ""}`.trim();
}

export default function PopupManager() {
  const [popups, setPopups] = useState<Popup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // 게시기간 날짜 필터 — 기본값: 오늘 ~ 한 달 뒤
  const [filterFrom, setFilterFrom] = useState(todayKST());
  const [filterTo, setFilterTo] = useState(oneMonthFromTodayKST());
  // 예정·진행중 탭(날짜 필터 사용) vs 지난 팝업 탭(게시기간이 이미 끝난 것만, 최근 종료순)
  const [viewMode, setViewMode] = useState<"upcoming" | "past">("upcoming");
  // 미리보기 화면에서 팝업을 직접 드래그로 옮기거나 모서리로 크기 조절할 때의 드래그 상태
  const [dragState, setDragState] = useState<{
    mode: "move" | "resize";
    startClientX: number; startClientY: number;
    startPosX: number; startPosY: number; startSize: number;
  } | null>(null);

  useEffect(() => {
    if (!dragState) return;
    function onMove(e: MouseEvent) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startClientX;
      const dy = e.clientY - dragState.startClientY;
      if (dragState.mode === "move") {
        const xPct = dragState.startPosX + (dx / window.innerWidth) * 100;
        const yPct = dragState.startPosY + (dy / window.innerHeight) * 100;
        setForm((f) => ({
          ...f, position: "custom",
          pos_x: Math.min(97, Math.max(3, xPct)),
          pos_y: Math.min(97, Math.max(3, yPct)),
        }));
      } else {
        const range = SIZE_RANGE[form.display_type];
        // 모서리를 오른쪽 아래로 끌면 커지도록 — x/y 이동량 중 큰 쪽을 기준으로 사용
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        const nextSize = Math.round(dragState.startSize + delta);
        setForm((f) => ({ ...f, size_px: Math.min(range.max, Math.max(range.min, nextSize)) }));
      }
    }
    function onUp() { setDragState(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState]);

  function startDrag(mode: "move" | "resize", e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // 프리셋/랜덤 위치에서 드래그를 시작하면, 지금 실제로 보이는 지점을 기준 좌표로 채택
    const basis = form.position === "custom"
      ? { x: form.pos_x, y: form.pos_y }
      : PRESET_PCT[form.position] ?? { x: 50, y: 50 };
    setDragState({
      mode,
      startClientX: e.clientX, startClientY: e.clientY,
      startPosX: basis.x, startPosY: basis.y, startSize: form.size_px,
    });
    if (form.position !== "custom") {
      setForm((f) => ({ ...f, position: "custom", pos_x: basis.x, pos_y: basis.y }));
    }
  }

  const fetchPopups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/popups");
      const json = await res.json();
      setPopups(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPopups(); }, [fetchPopups]);

  // 게시기간 안 + 사용중 = 지금 사이트에 실제로 떠 있는 팝업 (시각까지 비교)
  function isLive(p: Popup) {
    const now = Date.now();
    return p.is_active && new Date(p.start_date).getTime() <= now && new Date(p.end_date).getTime() >= now;
  }

  // 지난 팝업 탭: 게시기간이 이미 끝난 것만, 최근에 끝난 순
  const pastPopups = popups
    .filter((p) => kstDateOnly(p.end_date) < todayKST())
    .sort((a, b) => (a.end_date < b.end_date ? 1 : -1));

  // 예정·진행중 탭: 게시기간이 필터 범위와 겹치는 팝업만 — 기간이 하루라도 걸치면 포함 (필터는 날짜 단위)
  const upcomingPopups = popups.filter((p) => {
    if (filterFrom && kstDateOnly(p.end_date) < filterFrom) return false;
    if (filterTo && kstDateOnly(p.start_date) > filterTo) return false;
    return true;
  });

  const filteredPopups = viewMode === "past" ? pastPopups : upcomingPopups;

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowModal(true);
  }

  function openEdit(p: Popup) {
    setEditingId(p.id);
    setForm({
      title: p.title,
      start_date: toDatetimeLocalKST(p.start_date),
      end_date: toDatetimeLocalKST(p.end_date),
      image_url: p.image_url ?? "",
      link_url: p.link_url ?? "",
      content: p.content ?? "",
      // 이전 스키마({date, text})로 저장된 값이 남아있어도 깨지지 않게 from/to로 변환
      content_overrides: (p.content_overrides ?? []).map((o) => {
        const legacy = o as unknown as { date?: string; from?: string; to?: string; text: string };
        return { from: legacy.from ?? legacy.date ?? "", to: legacy.to ?? legacy.date ?? "", text: legacy.text };
      }),
      is_active: p.is_active,
      display_type: p.display_type ?? "modal",
      position: p.position ?? "bottom-right",
      pages: p.pages?.length ? p.pages : ["home"],
      random_page: p.random_page ?? false,
      hunt_code: p.hunt_code ?? "",
      size_px: p.size_px ?? SIZE_RANGE[p.display_type ?? "modal"]?.default ?? 420,
      pos_x: p.pos_x ?? 90,
      pos_y: p.pos_y ?? 90,
      effect: p.effect ?? "none",
    });
    setError(null);
    setShowModal(true);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/newsletter/upload-image", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "업로드 실패"); return; }
      setForm((f) => ({ ...f, image_url: json.url }));
    } catch {
      setError("업로드 실패");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.title.trim() || !form.start_date || !form.end_date) {
      setError("제목과 게시기간은 필수입니다.");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("종료일이 시작일보다 빠릅니다.");
      return;
    }
    if (!form.image_url && !form.content.trim()) {
      setError("이미지 또는 내용 중 하나는 있어야 합니다.");
      return;
    }
    if (form.pages.length === 0) {
      setError("노출 페이지를 최소 한 곳은 선택해야 합니다.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        start_date: fromDatetimeLocalKST(form.start_date),
        end_date: fromDatetimeLocalKST(form.end_date),
      };
      const res = await fetch("/api/admin/popups", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "저장 실패"); return; }
      setPopups((prev) =>
        editingId ? prev.map((p) => (p.id === editingId ? json.data : p)) : [json.data, ...prev]
      );
      setShowModal(false);
    } catch {
      setError("저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Popup) {
    const res = await fetch("/api/admin/popups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    });
    if (res.ok) {
      setPopups((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
    }
  }

  async function handleDelete(p: Popup) {
    if (!window.confirm(`"${p.title}" 팝업을 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/admin/popups?id=${p.id}`, { method: "DELETE" });
    if (res.ok) setPopups((prev) => prev.filter((x) => x.id !== p.id));
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

  return (
    <>
    <div className="p-5 rounded-lg mb-8 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5 flex items-center gap-1.5"
            style={{ color: "var(--on-surface-variant)" }}>
            등록된 팝업
            <SectionInfoModal title="팝업 안내">
              {[
                {
                  n: 1, title: "노출 조건",
                  body: "게시기간 안에 있고 사용여부가 켜져 있을 때만 노출됩니다. 조건에 맞는 팝업이 여러 개면 가장 최근에 등록한 것 하나만 표시됩니다.",
                },
                {
                  n: 2, title: "표시 방식",
                  body: "고정은 화면 구석에 계속 붙어 있고 닫기 버튼이 없어 상시 노출됩니다(이벤트 배너용). 팝업은 화면 가운데에 크게 뜨고, 방문자가 닫거나 오늘 하루 보지 않기를 누르면 그날은 다시 뜨지 않습니다.",
                },
                {
                  n: 3, title: "이미지",
                  body: "고정은 300×300px 정사각형(배경 투명 PNG 권장), 팝업은 400×500px가 적당합니다. 어떤 비율로 올려도 화면 크기에 맞춰 자동으로 축소됩니다.",
                },
                {
                  n: 4, title: "노출 페이지",
                  body: "팝업이 뜰 페이지 하나를 고릅니다 (기본값 홈).",
                },
                {
                  n: 5, title: "위치·크기",
                  body: "별도 입력란 없이 “미리보기에서 위치·크기 조정” 버튼을 눌러 실제 화면에서 직접 끌어다 놓고, 모서리를 드래그해 크기를 조절하세요. 랜덤 위치를 켜면 조정한 위치는 무시되고 접속할 때마다 다른 자리에 나타납니다(숨은 그림 찾기 이벤트용).",
                },
                {
                  n: 6, title: "링크 URL",
                  body: "입력하면 클릭 시 새 탭으로 이동합니다(구글폼 등). 비워두면 클릭해도 이동하지 않습니다.",
                },
              ].map(({ n, title: t, body }) => (
                <div key={n} style={{ marginBottom: 14 }}>
                  <p style={{ margin: "0 0 3px", fontWeight: 700, fontSize: 14, color: "#111" }}>
                    {n}. {t}
                  </p>
                  <p style={{ margin: 0, fontWeight: 400, fontSize: 13, color: "#555", lineHeight: 1.65 }}>
                    {body}
                  </p>
                </div>
              ))}
            </SectionInfoModal>
          </p>
          <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
            게시기간 안에 있고 사용이 켜진 팝업만 실제로 노출됩니다
          </p>
        </div>
        <button
          onClick={openNew}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "6px 14px", borderRadius: 6, border: "none",
            background: "var(--primary)", color: "#fff",
            fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >
          <Plus size={14} /> 새 팝업
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 7, background: "var(--surface-container-low)" }}>
          {([
            { key: "upcoming" as const, label: "예정·진행중" },
            { key: "past" as const, label: "지난 팝업" },
          ]).map(({ key, label }) => (
            <button key={key} onClick={() => setViewMode(key)}
              style={{
                padding: "5px 12px", borderRadius: 5, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 700,
                background: viewMode === key ? "var(--surface-container-lowest)" : "transparent",
                color: viewMode === key ? "var(--on-surface)" : "var(--on-surface-variant)",
                boxShadow: viewMode === key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}>
              {label}
            </button>
          ))}
        </div>
        {viewMode === "upcoming" ? (
          <>
            <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>게시기간 필터</span>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
              style={{ ...inputStyle, width: "auto", height: 30 }} />
            <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>~</span>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
              style={{ ...inputStyle, width: "auto", height: 30 }} />
            <button
              onClick={() => { setFilterFrom(todayKST()); setFilterTo(oneMonthFromTodayKST()); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--primary)", textDecoration: "underline" }}
            >
              기본값(오늘~한 달)
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>게시기간이 이미 끝난 팝업을 최근 종료순으로 보여줍니다</span>
        )}
        <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>{filteredPopups.length}건</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--on-surface-variant)" }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> 불러오는 중...
        </div>
      ) : filteredPopups.length === 0 ? (
        <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
          {popups.length === 0 ? "등록된 팝업이 없습니다." : viewMode === "past" ? "지난 팝업이 없습니다." : "이 기간에 게시되는 팝업이 없습니다."}
        </p>
      ) : (
        <div style={{ borderRadius: 8, border: "1px solid var(--surface-container-high)", overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface-container-high)" }}>
                {["No", "제목", "방식", "게시기간", "등록일", "사용", ""].map((h, i) => (
                  <th key={h || i} style={{
                    padding: "8px 12px", textAlign: i === 0 || i >= 4 ? "center" : "left",
                    fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em",
                    textTransform: "uppercase", color: "var(--on-surface-variant)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPopups.map((p, idx) => {
                const live = isLive(p);
                return (
                  <tr key={p.id} style={{
                    borderTop: "1px solid var(--surface-container-high)",
                    background: live ? "color-mix(in srgb, var(--primary) 5%, transparent)" : undefined,
                  }}>
                    <td style={{ padding: "9px 12px", textAlign: "center", color: "var(--on-surface-variant)", fontSize: "0.72rem" }}>
                      {filteredPopups.length - idx}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {p.hunt_code && (
                        <span title={`찾기 코드: ${p.hunt_code}`} style={{
                          marginRight: 5, padding: "1px 6px", borderRadius: 4, fontSize: 10,
                          fontWeight: 700, background: "#7c3aed18", color: "#7c3aed",
                        }}>🐱 {p.hunt_code}</span>
                      )}
                      {p.title}
                      {live && (
                        <span style={{
                          marginLeft: 6, padding: "1px 6px", borderRadius: 4, fontSize: 10,
                          fontWeight: 700, background: "var(--primary)", color: "#fff",
                        }}>노출중</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", color: "var(--on-surface-variant)", fontSize: "0.72rem" }}>
                      {p.display_type === "floating" ? `고정 · ${positionLabel(p.position)}` : "팝업"}
                      <span style={{ display: "block", opacity: 0.75 }}>
                        {p.random_page && (p.pages?.length ?? 0) > 1 ? "랜덤 " : ""}
                        {(p.pages?.length ? p.pages : ["home"]).map(pageLabel).join("·")}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px", color: "var(--on-surface-variant)" }}>
                      {fmtDateTime(p.start_date)} ~ {fmtDateTime(p.end_date)}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center", color: "var(--on-surface-variant)", fontSize: "0.72rem" }}>
                      {new Date(p.created_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      <button
                        onClick={() => toggleActive(p)}
                        style={{
                          padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: "1px solid",
                          borderColor: p.is_active ? "var(--primary)" : "var(--surface-container-highest)",
                          background: p.is_active ? "var(--primary)" : "transparent",
                          color: p.is_active ? "#fff" : "var(--on-surface-variant)",
                          cursor: "pointer",
                        }}
                      >
                        {p.is_active ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <button onClick={() => openEdit(p)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--primary)", textDecoration: "underline", padding: "0 4px" }}>
                        수정
                      </button>
                      <button onClick={() => handleDelete(p)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#dc2626", textDecoration: "underline", padding: "0 4px" }}>
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 등록·수정 모달 */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "var(--surface-container-lowest)", borderRadius: 12, padding: 24,
            width: 440, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}>
            <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 15 }}>
              {editingId ? "팝업 수정" : "새 팝업"}
            </p>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>제목 * <span style={{ fontWeight: 400 }}>(관리용 · 방문자에겐 안 보임)</span></label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>표시 방식 *</label>
              <div style={{ display: "flex", gap: 6 }}>
                {([
                  { key: "floating", label: "고정", desc: "구석에 상시 노출 · 닫기 없음" },
                  { key: "modal", label: "팝업", desc: "닫기 가능" },
                ] as const).map(({ key, label, desc }) => {
                  const on = form.display_type === key;
                  return (
                    <button key={key} onClick={() => setForm((f) => ({
                        ...f, display_type: key,
                        // 다른 방식으로 바꾸면 이전 방식 기준 크기가 안 맞을 수 있어 그 방식의 기본값으로 리셋
                        size_px: SIZE_RANGE[key].default,
                        // 팝업은 기본이 정가운데, 고정은 기본이 오른쪽 아래 — 방식 바꿀 때 위치도 그에 맞게 (직접 지정한 경우는 유지)
                        position: f.position === "bottom-right" || f.position === "middle-center"
                          ? (key === "modal" ? "middle-center" : "bottom-right")
                          : f.position,
                      }))}
                      style={{
                        flex: 1, padding: "8px 10px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                        border: `1px solid ${on ? "var(--primary)" : "var(--surface-container-highest)"}`,
                        background: on ? "color-mix(in srgb, var(--primary) 8%, transparent)" : "var(--surface-container-low)",
                      }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--on-surface)" }}>{label}</span>
                      <span style={{ display: "block", fontSize: 10, color: "var(--on-surface-variant)" }}>{desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>이미지</label>
              <label style={{
                display: "block", padding: 14, borderRadius: 8, cursor: "pointer", textAlign: "center",
                border: `1px dashed ${form.image_url ? "var(--primary)" : "var(--surface-container-highest)"}`,
                background: "var(--surface-container-low)",
              }}>
                <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={handleFileChange} />
                {uploading ? (
                  <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>업로드 중...</span>
                ) : form.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.image_url} alt="미리보기" style={{ maxHeight: 150, maxWidth: "100%", margin: "0 auto", display: "block" }} />
                ) : (
                  <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                    클릭해서 이미지 선택 · 권장 {form.display_type === "floating" ? "300×300px (배경 투명 PNG)" : "400×500px"}
                  </span>
                )}
              </label>
              {form.image_url && (
                <button onClick={() => setForm((f) => ({ ...f, image_url: "" }))}
                  style={{ marginTop: 4, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#dc2626", textDecoration: "underline", padding: 0 }}>
                  이미지 제거
                </button>
              )}
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>노출 페이지 *</label>
              <select
                value={form.pages[0] ?? "home"}
                onChange={(e) => setForm((f) => ({ ...f, pages: [e.target.value] }))}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {POPUP_PAGES.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setPreviewOpen(true)} disabled={!form.image_url && !form.content.trim()}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none",
                  background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
                  opacity: !form.image_url && !form.content.trim() ? 0.4 : 1,
                }}>
                미리보기에서 위치·크기 조정
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "var(--on-surface-variant)" }}>
                <input type="checkbox" checked={form.position === "random"}
                  onChange={(e) => setForm((f) => ({ ...f, position: e.target.checked ? "random" : "bottom-right" }))}
                  style={{ width: 14, height: 14, cursor: "pointer" }} />
                랜덤 위치 (숨은 그림 찾기용)
              </label>
            </div>

            {form.display_type === "floating" && (
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>이미지 효과</label>
                <select value={form.effect}
                  onChange={(e) => setForm((f) => ({ ...f, effect: e.target.value }))}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {Object.entries(EFFECT_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>시작 일시 *</label>
                <input type="datetime-local" value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>종료 일시 *</label>
                <input type="datetime-local" value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>
                링크 URL <span style={{ fontWeight: 400 }}>(클릭 시 이동 · 구글폼 등)</span>
              </label>
              <input value={form.link_url} placeholder="https://..." disabled={!!form.hunt_code.trim()}
                onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
                style={{ ...inputStyle, opacity: form.hunt_code.trim() ? 0.5 : 1 }} />
              {form.hunt_code.trim() && (
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--on-surface-variant)" }}>
                  찾기 코드가 있으면 링크 대신 코드를 알려주고 사라지므로 이 값은 사용되지 않습니다.
                </p>
              )}
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>내용 <span style={{ fontWeight: 400 }}>(선택 · 이미지 없이 텍스트만 띄울 때)</span></label>
              <textarea value={form.content} rows={3}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical" }} />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5 }}>
                날짜별 문구 오버라이드 <span style={{ fontWeight: 400 }}>(선택)</span>
                <SectionInfoModal title="날짜별 문구 오버라이드 안내">
                  <p style={{ margin: 0, fontWeight: 400, fontSize: 13, color: "#555", lineHeight: 1.65 }}>
                    하루만 다르게 하려면 시작·종료를 같은 날로, 여러 날 이어지면 기간으로 지정하세요.
                    <br /><br />
                    예: 게시기간이 8/4~8/6이고 실제 참여는 4일·6일만 가능하면, 8/5(하루)에만 &quot;6일부터 다시 참여 가능합니다&quot;처럼 다르게 띄울 수 있음
                  </p>
                </SectionInfoModal>
              </label>
              <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--on-surface-variant)" }}>
                특정 날짜·기간만 위 내용 대신 다른 문구를 보여주고 싶을 때 사용합니다
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
                {form.content_overrides.map((o, i) => (
                  <div key={i} style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: 8, borderRadius: 6, border: "1px solid var(--surface-container-highest)",
                  }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="date" value={o.from} title="시작일"
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          // 종료일이 비어있으면 시작일과 같이 채워서 "하루만" 지정이 한 번에 끝나게
                          content_overrides: f.content_overrides.map((row, j) => j === i ? { ...row, from: e.target.value, to: row.to || e.target.value } : row),
                        }))}
                        style={{ ...inputStyle, width: "auto", height: 30, flex: 1 }} />
                      <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>~</span>
                      <input type="date" value={o.to} title="종료일(하루만이면 시작일과 동일)"
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          content_overrides: f.content_overrides.map((row, j) => j === i ? { ...row, to: e.target.value } : row),
                        }))}
                        style={{ ...inputStyle, width: "auto", height: 30, flex: 1 }} />
                      <button
                        onClick={() => setForm((f) => ({ ...f, content_overrides: f.content_overrides.filter((_, j) => j !== i) }))}
                        title="삭제"
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--on-surface-variant)", padding: "0 4px" }}
                      >×</button>
                    </div>
                    <input type="text" value={o.text} placeholder="이 기간에 보여줄 문구"
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        content_overrides: f.content_overrides.map((row, j) => j === i ? { ...row, text: e.target.value } : row),
                      }))}
                      style={{ ...inputStyle, height: 30 }} />
                  </div>
                ))}
              </div>
              <button
                onClick={() => setForm((f) => ({ ...f, content_overrides: [...f.content_overrides, { from: "", to: "", text: "" }] }))}
                style={{ padding: "5px 10px", borderRadius: 6, border: "1px dashed var(--surface-container-highest)",
                  background: "var(--surface-container-lowest)", color: "var(--on-surface-variant)", fontSize: 12, cursor: "pointer" }}
              >
                + 날짜/기간 문구 추가
              </button>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>
                찾기 코드 <span style={{ fontWeight: 400 }}>(입력하면 숨은 그림 찾기 이벤트 대상이 됨)</span>
              </label>
              <input value={form.hunt_code} placeholder="예: 관광길 (비워두면 일반 팝업)"
                onChange={(e) => setForm((f) => ({ ...f, hunt_code: e.target.value }))} style={inputStyle} />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
              <input type="checkbox" checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                style={{ width: 14, height: 14, cursor: "pointer" }} />
              사용여부 (켜야 노출됩니다)
            </label>

            {error && <p style={{ margin: "0 0 10px", fontSize: 12, color: "#dc2626" }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(false)}
                style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "var(--surface-container-high)", color: "var(--on-surface)", cursor: "pointer", fontSize: 13 }}>
                취소
              </button>
              <button onClick={handleSave} disabled={saving || uploading}
                style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving || uploading ? 0.6 : 1 }}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 저장 전 실제 크기·위치 미리보기 — 실제 뉴스룸 화면을 배경으로 그 위에 겹쳐서 보여줌 */}
      {previewOpen && (() => {
        const isFloatingPreview = form.display_type === "floating";
        const place = resolvePreviewPlace(form.position, form.pos_x, form.pos_y, 20, 110);
        const previewUrl = PREVIEW_PAGE_URL[form.pages[0]] ?? "/";
        const previewEffect = isFloatingPreview ? (form.effect || "none") : "none";
        const previewEffectAnimation =
          previewEffect === "bounce" ? "popup-fx-bounce 1.2s ease-in-out infinite"
          : previewEffect === "shake" ? "popup-fx-shake 1.6s ease-in-out infinite"
          : undefined;
        const media = form.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.image_url} alt="미리보기" style={{ display: "block", width: "100%", height: "auto", animation: previewEffectAnimation }} />
        ) : isFloatingPreview ? (
          <span style={{
            display: "block", padding: "12px 18px", fontSize: "0.85rem", fontWeight: 700,
            color: "#fff", background: "var(--primary)", borderRadius: 999, whiteSpace: "nowrap",
          }}>
            {form.content}
          </span>
        ) : (
          <p style={{ margin: 0, padding: "18px 20px", fontSize: "0.9rem", lineHeight: 1.7, whiteSpace: "pre-wrap", background: "#fff" }}>
            {form.content}
          </p>
        );

        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 2000 }}>
            {/* 실제 뉴스룸 화면을 배경으로 — 관리자 화면이 비치지 않도록 실제 페이지를 그대로 로드 */}
            <iframe
              src={previewUrl}
              title="미리보기 배경"
              style={{
                position: "fixed", inset: 0, width: "100%", height: "100%", border: "none", zIndex: 2000,
                // 드래그 중엔 iframe이 마우스 이벤트를 가로채 드래그가 끊기므로 잠깐 꺼둠
                pointerEvents: dragState ? "none" : "auto",
              }}
            />
            {/* 팝업형은 실제로도 배경을 어둡게 깔고 뜨므로 동일하게 재현 */}
            {!isFloatingPreview && (
              <div style={{ position: "fixed", inset: 0, zIndex: 2001, background: "rgba(0,0,0,0.5)" }} />
            )}

            <div style={{
              position: "fixed", top: 16, left: 16, zIndex: 2100,
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 14px", borderRadius: 8, background: "#fff",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>미리보기</span>
              <span style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>
                {POPUP_PAGES.find((p) => p.key === form.pages[0])?.label ?? "홈"} 화면 기준
                {form.position === "random" && " · 랜덤 위치는 가운데에 예시로 표시"}
                {" · 끌어서 이동, 모서리로 크기 조절"}
              </span>
              <button onClick={() => setPreviewOpen(false)}
                style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                닫기
              </button>
            </div>

            {isFloatingPreview ? (
              <div
                onMouseDown={(e) => startDrag("move", e)}
                style={{
                  position: "fixed", ...place, zIndex: 2050,
                  width: `min(${form.size_px}px, 80vw)`,
                  filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.2))",
                  cursor: dragState?.mode === "move" ? "grabbing" : "grab",
                }}>
                {previewEffect !== "none" && (
                  <>
                    <style>{EFFECT_KEYFRAMES}</style>
                    <EffectOverlay effect={previewEffect} />
                  </>
                )}
                {media}
                <div
                  onMouseDown={(e) => startDrag("resize", e)}
                  title="드래그해서 크기 조절"
                  style={{
                    position: "absolute", right: -6, bottom: -6, width: 18, height: 18,
                    borderRadius: "50%", background: "var(--primary)", border: "2px solid #fff",
                    cursor: "nwse-resize", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }}
                />
              </div>
            ) : (
              <div style={{ position: "fixed", ...place, zIndex: 2050, width: `min(${form.size_px}px, calc(100vw - 40px))` }}>
                <div
                  onMouseDown={(e) => startDrag("move", e)}
                  style={{
                    background: "#fff", borderRadius: 12, overflow: "hidden",
                    maxHeight: "90vh", overflowY: "auto",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                    cursor: dragState?.mode === "move" ? "grabbing" : "grab",
                  }}>
                  {media}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px", borderTop: "1px solid var(--surface-container-high)",
                    background: "var(--surface-container-low)", fontSize: "0.78rem", color: "var(--on-surface-variant)",
                  }}>
                    <span>오늘 하루 보지 않기</span>
                    <span>닫기</span>
                  </div>
                </div>
                <div
                  onMouseDown={(e) => startDrag("resize", e)}
                  title="드래그해서 크기 조절"
                  style={{
                    position: "absolute", right: -6, bottom: -6, width: 18, height: 18,
                    borderRadius: "50%", background: "var(--primary)", border: "2px solid #fff",
                    cursor: "nwse-resize", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })()}
    </div>

    {/* 숨은 그림 찾기 이벤트 — 찾기 코드가 붙은 팝업들을 묶어서 관리 */}
    {!loading && <EventHuntManager huntPopups={popups.filter((p) => p.hunt_code)} />}
    </>
  );
}
