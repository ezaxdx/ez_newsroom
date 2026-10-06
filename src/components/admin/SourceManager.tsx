"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, ToggleLeft, ToggleRight, X as XIcon, Pin,
} from "lucide-react";
import HelpPanel, { HelpTrigger, Section, Item, Def } from "@/components/admin/HelpPanel";
import type { FetchConfig, KeywordMode, RssSource, SourceType } from "@/lib/types";

/* ───────── 상수·유틸 ───────── */
const WEIGHT_TIERS = [
  { label: "중요", value: 8 },
  { label: "보통", value: 5 },
  { label: "낮음", value: 2 },
] as const;
const weightLabel = (w: number) => (w >= 7 ? "중요" : w >= 4 ? "보통" : "낮음");
const MAX_ITEM_CHOICES = [3, 5, 10, 20];
const MIXED = "MIXED";
const categoryLabel = (c: string) => (c === MIXED ? "섞여 있음 (AI 판단)" : c);

const TYPE_LABEL: Record<string, string> = {
  rss: "RSS", web_list: "웹페이지 목록", json_list: "JSON API",
  url: "웹페이지(이전)", api: "공공 API(이전)", gmail: "Gmail(이전)", naver_news: "네이버(이전)", keyword_search: "검색",
};
const KEYWORD_TYPES: SourceType[] = ["keyword_search", "naver_news"];
const SOURCE_TYPES: SourceType[] = ["rss", "web_list", "json_list", "url"];

function relTime(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "방금 전";
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
/** 미리보기 날짜 — 서버가 UTC(ISO)로 주므로 한국시간 기준 월.일로 표시 */
const fmtMD = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
};
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "-";

type Tone = "ok" | "warn" | "bad" | "mute";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: "var(--bg-success, #e7f6ec)", fg: "var(--text-success, #166534)" },
  warn: { bg: "var(--bg-warning, #fef3c7)", fg: "var(--text-warning, #92400e)" },
  bad: { bg: "var(--bg-danger, #fee2e2)", fg: "var(--text-danger, #991b1b)" },
  mute: { bg: "var(--surface-container-high)", fg: "var(--on-surface-variant)" },
};

/** "최근 수집" 상태 — 이번 점검에서 가장 오래 몰랐던 문제(0건·오류·미실행)를 화면에서 바로 보이게 */
function statusOf(s: RssSource): { label: string; tone: Tone; sub?: string; title?: string } {
  if (!s.last_run_at) return { label: "실행 전", tone: "mute" };
  if (s.last_status === "error") return { label: "오류", tone: "bad", sub: (s.last_error ?? "").slice(0, 40), title: s.last_error ?? undefined };
  if (s.last_status === "empty") {
    const n = s.zero_streak ?? 1;
    return n >= 3 ? { label: `${n}회 연속 0건`, tone: "bad", sub: relTime(s.last_run_at) } : { label: "0건", tone: "warn", sub: relTime(s.last_run_at) };
  }
  return { label: "정상", tone: "ok", sub: `${s.last_fetched ?? 0}건 · ${relTime(s.last_run_at)}` };
}

function StatusChip({ s }: { s: RssSource }) {
  const st = statusOf(s);
  return (
    <div className="flex items-center gap-2 min-w-0" title={st.title}>
      <span className="text-[0.7rem] font-semibold px-2 py-0.5 rounded whitespace-nowrap" style={{ background: TONE[st.tone].bg, color: TONE[st.tone].fg }}>{st.label}</span>
      {st.sub && <span className="text-[0.7rem] truncate" style={{ color: "var(--on-surface-variant)" }}>{st.sub}</span>}
    </div>
  );
}

const inputStyle: React.CSSProperties = { background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" };
const labelCls = "text-[0.7rem] font-semibold tracking-wide";
const labelStyle: React.CSSProperties = { color: "var(--on-surface-variant)" };

/* ───────── 미리보기 타입·호출 ───────── */
interface PreviewItem { title: string; link: string; pubDate: string; matched?: boolean; via?: string }
interface PreviewResult {
  ok: boolean; detected_type?: string; mode?: string; page_title?: string; suggested_url?: string; fetch_config?: FetchConfig;
  items: PreviewItem[]; total: number; matched?: number; engines?: Record<string, { count: number; recent7d: number; error?: string }>;
  overlap?: number; error?: string; hint?: string; elapsed_ms?: number;
}
async function runPreview(body: Record<string, unknown>): Promise<PreviewResult> {
  try {
    const res = await fetch("/api/admin/rss/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as PreviewResult;
  } catch (e) {
    return { ok: false, items: [], total: 0, error: `미리보기 요청 실패: ${(e as Error).message}` };
  }
}

/* ───────── 공통 UI 조각 ───────── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: "rgba(26,28,29,0.45)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-xl p-5 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)", boxShadow: "0 8px 32px rgba(26,28,29,0.18)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold m-0">{title}</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}><XIcon size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { label: string; value: T }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} className="flex-1 h-8 rounded-md text-xs font-semibold transition-colors"
            style={{ background: on ? "var(--primary)" : "var(--surface-container-low)", color: on ? "#fff" : "var(--on-surface-variant)", border: "none", cursor: "pointer" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
function PreviewList({ r, matchFn }: { r: PreviewResult; matchFn?: (it: PreviewItem) => boolean }) {
  const items = r.items.map((it) => ({ ...it, matched: matchFn ? matchFn(it) : it.matched }));
  const matched = items.filter((i) => i.matched !== false).length;
  // 키워드 조건을 화면에서 다시 계산할 땐 내려받은 기사(최대 40건) 기준, 아니면 서버가 센 전체 건수 기준
  const allMatch = !matchFn && (r.matched === undefined || r.matched === r.total);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: "var(--on-surface-variant)" }}>
        {allMatch
          ? <span>총 <b style={{ color: "var(--on-surface)" }}>{r.total}건</b></span>
          : matchFn
            ? <span>미리보기 {items.length}건 중 <b style={{ color: "var(--on-surface)" }}>{matched}건</b> 해당</span>
            : <span>{r.total}건 중 <b style={{ color: "var(--on-surface)" }}>{r.matched}건</b> 해당</span>}
        {r.elapsed_ms != null && <span>· {(r.elapsed_ms / 1000).toFixed(1)}초</span>}
      </div>
      <div className="rounded-lg overflow-hidden max-h-56 overflow-y-auto" style={{ border: "1px solid var(--surface-container-highest)" }}>
        {items.slice(0, 30).map((it, i) => (
          <div key={i} className="grid gap-2 px-3 py-1.5 text-xs items-center" style={{ gridTemplateColumns: "minmax(0,1fr) 72px", borderTop: i ? "1px solid var(--surface-container-highest)" : "none", opacity: it.matched === false ? 0.45 : 1 }}>
            <span className="truncate" title={it.title}>{it.matched === false && <span style={{ color: "var(--on-surface-variant)" }}>(제외) </span>}{it.title}</span>
            <span className="text-right" style={{ color: "var(--on-surface-variant)" }}>{fmtMD(it.pubDate) || (it.via === "naver" ? "네이버" : it.via === "google" ? "구글" : "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── 키워드 추가·수정 창 ───────── */
function KeywordDialog({ initial, categories, onClose, onSaved }: { initial?: RssSource; categories: string[]; onClose: () => void; onSaved: (s: RssSource | null) => void }) {
  const [keyword, setKeyword] = useState(initial?.url ?? "");
  const [category, setCategory] = useState(initial?.default_category ?? categories[0] ?? "MICE");
  const initEngines = initial ? (initial.source_type === "naver_news" ? ["naver"] : initial.fetch_config?.engines ?? ["naver"]) : ["naver", "google"];
  const [naver, setNaver] = useState(initEngines.includes("naver"));
  const [google, setGoogle] = useState(initEngines.includes("google"));
  const [maxItems, setMaxItems] = useState(initial?.max_items ?? 5);
  const [weight, setWeight] = useState(initial?.weight ?? 8);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const engines = [naver && "naver", google && "google"].filter(Boolean) as string[];

  const doPreview = async () => {
    if (!keyword.trim() || !engines.length) return;
    setLoading(true); setPreview(null);
    setPreview(await runPreview({ kind: "keyword", keyword: keyword.trim(), engines }));
    setLoading(false);
  };
  const save = async () => {
    setSaving(true); setErr("");
    const payload = {
      url: keyword.trim(), source_name: keyword.trim(), source_type: "keyword_search", default_category: category, weight,
      max_items: maxItems, keyword_mode: "none", keyword_filter: false, fetch_config: { engines },
    };
    const res = await fetch("/api/admin/rss", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(initial ? { id: initial.id, ...payload } : { ...payload, is_active: true }) });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setErr(json.error ?? "저장 실패"); return; }
    onSaved(initial ? null : json.data);
  };

  return (
    <Modal title={initial ? "검색 키워드 수정" : "검색 키워드 추가"} onClose={onClose}>
      <div className="flex flex-col gap-1">
        <label className={labelCls} style={labelStyle}>키워드</label>
        <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setPreview(null); }} placeholder="예: 스마트관광" className="h-9 px-3 rounded-md text-sm outline-none" style={inputStyle} autoFocus />
        <p className="text-[0.7rem] m-0" style={labelStyle}>따옴표로 감싸면(예: &quot;글로컬 관광&quot;) 그 문구가 그대로 들어간 기사만 찾아요. 다른 뜻으로 쓰이는 단어가 섞일 때 유용합니다.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls} style={labelStyle}>검색 대상</label>
          <div className="flex gap-1.5">
            {([["네이버", naver, setNaver], ["구글", google, setGoogle]] as const).map(([label, on, set]) => (
              <button key={label} type="button" onClick={() => { set(!on); setPreview(null); }} className="flex-1 h-8 rounded-md text-xs font-semibold flex items-center justify-center gap-1"
                style={{ background: on ? "var(--primary)" : "var(--surface-container-low)", color: on ? "#fff" : "var(--on-surface-variant)", border: "none", cursor: "pointer" }}>
                {on && <Check size={12} />}{label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} style={labelStyle}>카테고리</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 px-3 rounded-md text-sm outline-none" style={inputStyle}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} style={labelStyle}>1회 최대 건수</label>
          <select value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} className="h-8 px-3 rounded-md text-sm outline-none" style={inputStyle}>
            {MAX_ITEM_CHOICES.map((n) => <option key={n} value={n}>{n}건</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} style={labelStyle}>중요도</label>
        <Segmented value={weightLabel(weight)} options={WEIGHT_TIERS.map((t) => ({ label: t.label, value: t.label }))} onChange={(l) => setWeight(WEIGHT_TIERS.find((t) => t.label === l)!.value)} />
      </div>

      <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "var(--surface-container-low)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">미리보기 · 최근 7일</span>
          <button type="button" onClick={doPreview} disabled={loading || !keyword.trim() || !engines.length} className="h-7 px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}확인
          </button>
        </div>
        {!preview && !loading && <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>[확인]을 누르면 엔진별로 몇 건이 잡히는지 미리 볼 수 있어요.</p>}
        {preview && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--on-surface-variant)" }}>
              {Object.entries(preview.engines ?? {}).map(([e, v]) => (
                <span key={e}>{e === "naver" ? "네이버" : "구글"}: {v.error ? <b style={{ color: TONE.bad.fg }}>오류 ({v.error})</b> : <><b style={{ color: "var(--on-surface)" }}>{v.recent7d}건</b> (전체 {v.count})</>}</span>
              ))}
              {engines.length > 1 && <span>겹치는 기사: <b style={{ color: "var(--on-surface)" }}>{preview.overlap ?? 0}건</b></span>}
            </div>
            {preview.ok ? <PreviewList r={preview} /> : <p className="text-xs m-0" style={{ color: TONE.bad.fg }}>{preview.error}</p>}
          </>
        )}
      </div>

      {err && <p className="text-xs m-0" style={{ color: TONE.bad.fg }}>{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-medium" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>취소</button>
        <button onClick={save} disabled={saving || !keyword.trim() || !engines.length} className="h-9 px-4 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-40" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
          {saving && <Loader2 size={13} className="animate-spin" />}{initial ? "저장" : "추가"}
        </button>
      </div>
    </Modal>
  );
}

/* ───────── 지정 소스 추가·수정 창 ───────── */
function SourceDialog({ initial, categories, focusKeywords, onClose, onSaved }: { initial?: RssSource; categories: string[]; focusKeywords: string[]; onClose: () => void; onSaved: (s: RssSource | null) => void }) {
  const catOptions = useMemo(() => [...new Set([...categories, "EZPMP"])], [categories]);
  const [category, setCategory] = useState(initial?.default_category ?? catOptions[0] ?? "MICE");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [name, setName] = useState(initial?.source_name ?? "");
  const [weight, setWeight] = useState(initial?.weight ?? 5);
  const initMode: KeywordMode = initial ? (initial.keyword_mode && initial.keyword_mode !== "none" ? initial.keyword_mode : initial.keyword_filter ? "default" : "none") : "none";
  const [mode, setMode] = useState<KeywordMode>(initMode);
  const [customText, setCustomText] = useState((initial?.custom_keywords ?? []).join(", "));
  const [maxItems, setMaxItems] = useState(initial?.max_items ?? 5);
  const [advOpen, setAdvOpen] = useState(false);
  const [cfgText, setCfgText] = useState(initial?.fetch_config && Object.keys(initial.fetch_config).length ? JSON.stringify(initial.fetch_config, null, 2) : "");
  const [detected, setDetected] = useState<string | undefined>(initial?.source_type);
  const [detectedCfg, setDetectedCfg] = useState<FetchConfig | undefined>(initial?.fetch_config ?? undefined);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [stale, setStale] = useState(!!initial);       // 수정 화면은 열 때 자동으로 한 번 확인
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const customKeywords = useMemo(() => customText.split(/[,\n]/).map((k) => k.trim()).filter(Boolean), [customText]);
  const parsedCfg = useMemo((): { ok: boolean; value?: FetchConfig } => {
    if (!cfgText.trim()) return { ok: true, value: undefined };
    try { return { ok: true, value: JSON.parse(cfgText) as FetchConfig }; } catch { return { ok: false }; }
  }, [cfgText]);

  const matchFn = useMemo(() => {
    if (mode === "none") return undefined;
    const kws = (mode === "custom" ? customKeywords : focusKeywords).map((k) => k.toLowerCase());
    return (it: PreviewItem) => kws.some((k) => it.title.toLowerCase().includes(k));
  }, [mode, customKeywords, focusKeywords]);

  const doPreview = async () => {
    if (!/^https?:\/\//i.test(url.trim())) { setPreview({ ok: false, items: [], total: 0, error: "http(s):// 로 시작하는 주소를 입력하세요" }); return; }
    if (!parsedCfg.ok) { setPreview({ ok: false, items: [], total: 0, error: "고급 설정 JSON 형식이 올바르지 않습니다" }); return; }
    setLoading(true); setPreview(null); setStale(false);
    const sameAsSaved = !!initial && url.trim() === initial.url;
    const r = await runPreview({
      kind: "source", url: url.trim(), keyword_mode: mode, custom_keywords: customKeywords,
      // 주소를 바꾸지 않은 수정 화면은 기존 방식·설정 그대로, 새 주소나 직접 입력한 설정은 그 설정으로 확인
      ...(sameAsSaved && initial ? { source_type: initial.source_type } : {}),
      ...(parsedCfg.value ? { fetch_config: parsedCfg.value } : sameAsSaved && initial?.fetch_config ? { fetch_config: initial.fetch_config } : {}),
    });
    setLoading(false); setPreview(r);
    if (r.detected_type) setDetected(r.detected_type);
    if (r.fetch_config && Object.keys(r.fetch_config).length && !parsedCfg.value) setDetectedCfg(r.fetch_config);
    if (r.suggested_url) setUrl(r.suggested_url);
    if (!name.trim() && r.page_title) setName(r.page_title);
    if (!r.ok && r.fetch_config && Object.keys(r.fetch_config).length) { setAdvOpen(true); if (!cfgText.trim()) setCfgText(JSON.stringify(r.fetch_config, null, 2)); }
  };
  useEffect(() => { if (initial) void doPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const canSave = !saving && !!name.trim() && !!url.trim() && !!preview?.ok && !stale && parsedCfg.ok && (mode !== "custom" || customKeywords.length > 0);
  const save = async () => {
    setSaving(true); setErr("");
    const finalCfg = parsedCfg.value ?? detectedCfg ?? {};
    const payload = {
      url: url.trim(), source_name: name.trim(), source_type: detected ?? "rss", default_category: category, weight, max_items: maxItems,
      keyword_mode: mode, custom_keywords: customKeywords, keyword_filter: mode === "default", fetch_config: finalCfg,
    };
    const res = await fetch("/api/admin/rss", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(initial ? { id: initial.id, ...payload } : { ...payload, is_active: true }) });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setErr(json.error ?? "저장 실패"); return; }
    onSaved(initial ? null : json.data);
  };

  return (
    <Modal title={initial ? "지정 소스 수정" : "지정 소스 추가"} onClose={onClose}>
      <div className="flex flex-col gap-1">
        <label className={labelCls} style={labelStyle}>카테고리</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 px-3 rounded-md text-sm outline-none" style={inputStyle}>
          {[...catOptions, MIXED].map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <p className="text-[0.7rem] m-0" style={labelStyle}>이 소스의 기사가 들어갈 카테고리입니다. MICE·관광 기사가 섞여 올라오는 매체는 &quot;섞여 있음&quot;을 고르면 AI가 기사별로 판단해요.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls} style={labelStyle}>매체·블로그·게시판 목록 페이지 주소</label>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); setStale(true); }} onKeyDown={(e) => e.key === "Enter" && doPreview()} placeholder="https://..." className="flex-1 h-9 px-3 rounded-md text-sm outline-none" style={inputStyle} autoFocus={!initial} />
          <button type="button" onClick={doPreview} disabled={loading || !url.trim()} className="h-9 px-4 rounded-md text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}확인
          </button>
        </div>
        <p className="text-[0.7rem] m-0" style={labelStyle}>RSS 주소, 기사 목록 페이지, 게시판 주소 무엇이든 붙여넣으면 수집 방식을 자동으로 찾습니다.</p>
      </div>

      {/* 판별·미리보기 결과 */}
      {loading && <div className="flex items-center gap-2 text-xs" style={labelStyle}><Loader2 size={13} className="animate-spin" />주소를 열어 확인하는 중… (사이트에 따라 최대 30초)</div>}
      {preview && !loading && (
        <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "var(--surface-container-low)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            {preview.ok
              ? <span className="text-[0.7rem] font-semibold px-2 py-0.5 rounded flex items-center gap-1" style={{ background: TONE.ok.bg, color: TONE.ok.fg }}><Check size={11} />기사 {preview.total}건 찾음</span>
              : <span className="text-[0.7rem] font-semibold px-2 py-0.5 rounded flex items-center gap-1" style={{ background: TONE.bad.bg, color: TONE.bad.fg }}><AlertTriangle size={11} />{preview.error ?? "기사를 찾지 못했어요"}</span>}
            {preview.detected_type && <span className="text-[0.7rem] font-semibold px-2 py-0.5 rounded" style={{ background: "var(--bg-accent, #e0ecff)", color: "var(--text-accent, #1d4ed8)" }}>{TYPE_LABEL[preview.detected_type] ?? preview.detected_type}{preview.mode === "render" ? " · 렌더링 사용" : ""}</span>}
            {preview.suggested_url && <span className="text-[0.7rem]" style={labelStyle}>페이지에 있던 RSS 주소로 바꿨어요</span>}
          </div>
          {preview.hint && <p className="text-xs m-0" style={labelStyle}>{preview.hint}</p>}
          {preview.items.length > 0 && <PreviewList r={preview} matchFn={matchFn} />}
        </div>
      )}

      {/* 3단계 설정 — 확인이 끝나면 활성화 */}
      <div className="flex flex-col gap-3" style={{ opacity: preview?.ok || initial ? 1 : 0.5 }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls} style={labelStyle}>소스명 (페이지 제목에서 자동 입력)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 px-3 rounded-md text-sm outline-none" style={inputStyle} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} style={labelStyle}>중요도</label>
            <Segmented value={weightLabel(weight)} options={WEIGHT_TIERS.map((t) => ({ label: t.label, value: t.label }))} onChange={(l) => setWeight(WEIGHT_TIERS.find((t) => t.label === l)!.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} style={labelStyle}>가져올 기사</label>
          <Segmented<KeywordMode> value={mode} options={[{ label: "전체", value: "none" }, { label: "기본 키워드가 들어간 기사", value: "default" }, { label: "지정 키워드가 들어간 기사", value: "custom" }]} onChange={setMode} />
          {mode === "custom" && (
            <input value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="쉼표로 구분: 관광, 여행, 축제" className="h-9 px-3 rounded-md text-sm outline-none mt-1" style={inputStyle} />
          )}
          <p className="text-[0.7rem] m-0" style={labelStyle}>기사 제목에 키워드가 있는지로 걸러요. 위 미리보기에 바로 반영됩니다.{mode === "default" && ` (기본 키워드 ${focusKeywords.length}개)`}</p>
        </div>
        <div className="flex flex-col gap-1 sm:w-48">
          <label className={labelCls} style={labelStyle}>1회 최대 건수</label>
          <select value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} className="h-8 px-3 rounded-md text-sm outline-none" style={inputStyle}>
            {MAX_ITEM_CHOICES.map((n) => <option key={n} value={n}>{n}건</option>)}
          </select>
        </div>
        <div>
          <button type="button" onClick={() => setAdvOpen((o) => !o)} className="flex items-center gap-1 text-xs" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}>
            {advOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}고급 설정 (요청 방식, 목록 영역, 데이터 주소 직접 지정)
          </button>
          {advOpen && (
            <div className="flex flex-col gap-1 mt-2">
              <textarea value={cfgText} onChange={(e) => { setCfgText(e.target.value); setStale(true); }} rows={8} spellCheck={false} placeholder={'{\n  "region": { "start": "class=\\"list\\"", "end": "</section>" },\n  "link_template": "https://사이트/view?no={id}"\n}'}
                className="px-3 py-2 rounded-md text-xs font-mono outline-none" style={{ ...inputStyle, resize: "vertical" }} />
              {!parsedCfg.ok && <p className="text-[0.7rem] m-0" style={{ color: TONE.bad.fg }}>JSON 형식이 올바르지 않습니다</p>}
              <p className="text-[0.7rem] m-0" style={labelStyle}>수정한 뒤에는 위 [확인]으로 다시 가져와야 저장할 수 있어요.</p>
            </div>
          )}
        </div>
      </div>

      {err && <p className="text-xs m-0" style={{ color: TONE.bad.fg }}>{err}</p>}
      {stale && !loading && <p className="text-[0.7rem] m-0" style={labelStyle}>주소나 고급 설정을 바꿨다면 [확인]으로 기사를 다시 가져와야 저장할 수 있어요.</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-medium" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>취소</button>
        <button onClick={save} disabled={!canSave} className="h-9 px-4 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-40" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
          {saving && <Loader2 size={13} className="animate-spin" />}{initial ? "저장" : "추가"}
        </button>
      </div>
    </Modal>
  );
}

/* ───────── 메인 ───────── */
interface LastRun { run_at: string; duration_ms: number; fetched: number; published: number; staged: number; skipped: number; failed: number; errors?: { source: string; error: string }[] | null }

export default function SourceManager() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [sources, setSources] = useState<RssSource[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [categories, setCategories] = useState<string[]>(["MICE", "TOURISM", "AI"]);
  const [focusKeywords, setFocusKeywords] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [kwDialog, setKwDialog] = useState<{ open: boolean; initial?: RssSource }>({ open: false });
  const [srcDialog, setSrcDialog] = useState<{ open: boolean; initial?: RssSource }>({ open: false });
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [savingKeywords, setSavingKeywords] = useState(false);

  const load = async () => {
    const [rssData, catData] = await Promise.all([fetch("/api/admin/rss").then((r) => r.json()), fetch("/api/admin/categories").then((r) => r.json())]);
    setSources(rssData.data ?? []);
    setLastRun(rssData.lastRun ?? null);
    setCategories((catData.categories ?? ["MICE", "TOURISM", "AI"]).filter((c: string) => c !== "EZPMP"));
    setFocusKeywords(catData.focusKeywords ?? []);
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const byActiveThenWeight = (a: RssSource, b: RssSource) => Number(b.is_active) - Number(a.is_active) || (b.weight ?? 0) - (a.weight ?? 0) || a.source_name.localeCompare(b.source_name);
  const keywordRows = sources.filter((s) => KEYWORD_TYPES.includes(s.source_type)).sort(byActiveThenWeight);
  const sourceRows = sources.filter((s) => SOURCE_TYPES.includes(s.source_type)).sort(byActiveThenWeight);
  const legacyRows = sources.filter((s) => !KEYWORD_TYPES.includes(s.source_type) && !SOURCE_TYPES.includes(s.source_type));
  const activeCount = sources.filter((s) => s.is_active && s.source_type !== "api" && s.source_type !== "gmail").length;
  const okCount = sources.filter((s) => s.is_active && s.last_status === "ok").length;
  const problemCount = sources.filter((s) => s.is_active && (s.last_status === "error" || (s.zero_streak ?? 0) >= 3)).length;

  const toggleActive = async (s: RssSource) => {
    setSources((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_active: !x.is_active } : x)));
    await fetch("/api/admin/rss", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, is_active: !s.is_active }) });
  };
  const remove = async (s: RssSource) => {
    if (!confirm(`"${s.source_name}"을(를) 삭제할까요?`)) return;
    setSources((prev) => prev.filter((x) => x.id !== s.id));
    await fetch("/api/admin/rss", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id }) });
  };

  const saveFocusKeywords = async (next: string[]) => {
    setSavingKeywords(true); setFocusKeywords(next);
    await fetch("/api/admin/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ focusKeywords: next }) });
    setSavingKeywords(false);
  };
  const addFocusKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw || focusKeywords.includes(kw)) return;
    void saveFocusKeywords([...focusKeywords, kw]); setNewKeyword("");
  };

  const rowActions = (s: RssSource, onEdit: () => void) => (
    <div className="flex items-center justify-end gap-0.5">
      <button onClick={() => toggleActive(s)} title={s.is_active ? "끄기" : "켜기"} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
        {s.is_active ? <ToggleRight size={20} style={{ color: "var(--primary)" }} /> : <ToggleLeft size={20} style={{ color: "var(--on-surface-variant)" }} />}
      </button>
      <button onClick={onEdit} title="수정" className="p-1.5 rounded" style={{ background: "transparent", border: "none", cursor: "pointer" }}><Pencil size={14} style={{ color: "var(--on-surface-variant)" }} /></button>
      <button onClick={() => remove(s)} title="삭제" className="p-1.5 rounded" style={{ background: "transparent", border: "none", cursor: "pointer" }}><Trash2 size={14} style={{ color: "#dc2626" }} /></button>
    </div>
  );
  const boxStyle: React.CSSProperties = { background: "var(--surface-container-lowest)", border: "1px solid var(--surface-container-highest)" };
  const headCell = "text-[0.65rem] font-semibold tracking-wide";

  const keywordGrid = "minmax(0,1.4fr) 76px 56px 56px minmax(0,1.3fr) 112px";
  const sourceGrid = "minmax(0,1.6fr) 110px 80px 52px minmax(0,1.1fr) minmax(0,1.3fr) 112px";

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-5 gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0 flex items-center gap-2">수집 소스 <HelpTrigger onClick={() => setHelpOpen(true)} /></h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>뉴스 큐레이션이 기사를 가져오는 곳을 관리합니다</p>
        </div>
      </div>

      {/* 마지막 실행 요약 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { k: "마지막 정기 실행", v: lastRun ? fmtDateTime(lastRun.run_at) : "-", sub: lastRun ? `${Math.round(lastRun.duration_ms / 1000)}초 걸림` : "기록 없음" },
          { k: "발행 / 대기", v: lastRun ? `${lastRun.published} / ${lastRun.staged}` : "-", sub: lastRun ? `실패 ${lastRun.failed}건` : "" },
          { k: "활성 소스", v: `${activeCount}개`, sub: `최근 정상 수집 ${okCount}개` },
          { k: "점검 필요", v: `${problemCount}개`, sub: problemCount ? "오류·연속 0건 소스" : "문제 없음", warn: problemCount > 0 },
        ].map((c) => (
          <div key={c.k} className="rounded-lg px-4 py-3" style={{ background: "var(--surface-container-low)" }}>
            <p className="text-[0.7rem] m-0" style={{ color: "var(--on-surface-variant)" }}>{c.k}</p>
            <p className="text-lg font-bold m-0 mt-0.5" style={{ color: c.warn ? TONE.bad.fg : "var(--on-surface)" }}>{c.v}</p>
            <p className="text-[0.7rem] m-0" style={{ color: "var(--on-surface-variant)" }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin" style={{ color: "var(--on-surface-variant)" }} /></div>
      ) : (
        <>
          {/* ── 검색 키워드 ── */}
          <section className="rounded-xl mb-5 overflow-x-auto" style={boxStyle}>
           <div style={{ minWidth: 760 }}>
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <h3 className="text-sm font-bold m-0 flex items-center gap-1.5"><Search size={14} />검색 키워드</h3>
                <p className="text-xs m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>키워드 하나로 네이버뉴스·구글뉴스를 함께 검색합니다</p>
              </div>
              <button onClick={() => setKwDialog({ open: true })} className="flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-semibold" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}><Plus size={14} />키워드 추가</button>
            </div>
            <div className="hidden sm:grid items-center gap-3 px-4 py-2" style={{ gridTemplateColumns: keywordGrid, background: "var(--surface-container)" }}>
              {["키워드", "카테고리", "네이버", "구글", "최근 수집", ""].map((h, i) => <span key={i} className={headCell} style={labelStyle}>{h}</span>)}
            </div>
            {keywordRows.length === 0 && <p className="text-sm px-4 py-6 m-0 text-center" style={{ color: "var(--on-surface-variant)" }}>등록된 검색 키워드가 없습니다.</p>}
            {keywordRows.map((s) => {
              const eng = s.source_type === "naver_news" ? ["naver"] : s.fetch_config?.engines ?? ["naver"];
              return (
                <div key={s.id} className="grid items-center gap-3 px-4 py-2.5 text-sm" style={{ gridTemplateColumns: keywordGrid, borderTop: "1px solid var(--surface-container-highest)", opacity: s.is_active ? 1 : 0.5 }}>
                  <span className="font-semibold truncate" title={s.url}>{s.url}{s.source_type === "naver_news" && <span className="ml-1.5 text-[0.65rem] font-normal" style={{ color: "var(--on-surface-variant)" }}>(이전 방식)</span>}</span>
                  <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>{s.default_category}</span>
                  <span>{eng.includes("naver") ? <Check size={15} style={{ color: "var(--primary)" }} /> : <span style={{ color: "var(--on-surface-variant)" }}>-</span>}</span>
                  <span>{eng.includes("google") ? <Check size={15} style={{ color: "var(--primary)" }} /> : <span style={{ color: "var(--on-surface-variant)" }}>-</span>}</span>
                  <StatusChip s={s} />
                  {rowActions(s, () => setKwDialog({ open: true, initial: s }))}
                </div>
              );
            })}
           </div>
          </section>

          {/* ── 지정 소스 ── */}
          <section className="rounded-xl mb-5 overflow-x-auto" style={boxStyle}>
           <div style={{ minWidth: 980 }}>
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <h3 className="text-sm font-bold m-0 flex items-center gap-1.5"><Pin size={14} />지정 소스</h3>
                <p className="text-xs m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>꼭 챙길 매체·블로그를 직접 등록합니다</p>
              </div>
              <button onClick={() => setSrcDialog({ open: true })} className="flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-semibold" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}><Plus size={14} />소스 추가</button>
            </div>
            <div className="hidden sm:grid items-center gap-3 px-4 py-2" style={{ gridTemplateColumns: sourceGrid, background: "var(--surface-container)" }}>
              {["소스", "방식", "카테고리", "중요도", "가져올 기사", "최근 수집", ""].map((h, i) => <span key={i} className={headCell} style={labelStyle}>{h}</span>)}
            </div>
            {sourceRows.length === 0 && <p className="text-sm px-4 py-6 m-0 text-center" style={{ color: "var(--on-surface-variant)" }}>등록된 소스가 없습니다.</p>}
            {sourceRows.map((s) => {
              const mode = s.keyword_mode && s.keyword_mode !== "none" ? s.keyword_mode : s.keyword_filter ? "default" : "none";
              const range = mode === "custom" ? `${(s.custom_keywords ?? []).join(", ")}` : mode === "default" ? "기본 키워드" : "전체";
              return (
                <div key={s.id} className="grid items-center gap-3 px-4 py-2.5 text-sm" style={{ gridTemplateColumns: sourceGrid, borderTop: "1px solid var(--surface-container-highest)", opacity: s.is_active ? 1 : 0.5 }}>
                  <div className="min-w-0">
                    <p className="font-semibold m-0 truncate">{s.source_name}</p>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[0.7rem] truncate block" style={{ color: "var(--on-surface-variant)", textDecoration: "none" }} title={s.url}>{s.url}</a>
                  </div>
                  <span className="text-[0.7rem] font-semibold px-2 py-0.5 rounded w-fit whitespace-nowrap" style={{ background: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>{TYPE_LABEL[s.source_type] ?? s.source_type}</span>
                  <span className="text-xs truncate" style={{ color: "var(--on-surface-variant)" }} title={categoryLabel(s.default_category)}>{s.default_category === MIXED ? "섞여 있음" : s.default_category}</span>
                  <span className="text-xs font-semibold" style={{ color: s.weight >= 7 ? "var(--primary)" : "var(--on-surface-variant)" }}>{weightLabel(s.weight)}</span>
                  <span className="text-xs truncate" style={{ color: "var(--on-surface-variant)" }} title={range}>{range} · 최대 {s.max_items ?? 10}건</span>
                  <StatusChip s={s} />
                  {rowActions(s, () => setSrcDialog({ open: true, initial: s }))}
                </div>
              );
            })}
           </div>
          </section>

          {/* ── 이전 방식 (정리 예정) ── */}
          {legacyRows.length > 0 && (
            <section className="mb-5">
              <button onClick={() => setLegacyOpen((o) => !o)} className="flex items-center gap-1.5 text-xs" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}>
                {legacyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}지원이 끝난 수집 방식 {legacyRows.length}개 (Gmail·공공 API) — 더 이상 수집하지 않아요
              </button>
              {legacyOpen && (
                <div className="rounded-xl mt-2" style={boxStyle}>
                  {legacyRows.map((s, i) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm" style={{ borderTop: i ? "1px solid var(--surface-container-highest)" : "none", opacity: 0.7 }}>
                      <span className="truncate">{s.source_name} <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>· {TYPE_LABEL[s.source_type] ?? s.source_type}</span></span>
                      <button onClick={() => remove(s)} title="삭제" className="p-1.5 rounded" style={{ background: "transparent", border: "none", cursor: "pointer" }}><Trash2 size={14} style={{ color: "#dc2626" }} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── 기본 관심 키워드 ── */}
          <div className="mb-6">
            <button onClick={() => setKeywordsOpen((o) => !o)} className="flex items-center gap-1.5 text-xs" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}>
              {keywordsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}기본 관심 키워드 ({focusKeywords.length})
            </button>
            {keywordsOpen && (
              <div className="mt-2 p-4 rounded-lg" style={boxStyle}>
                <p className="text-xs mb-3 mt-0" style={{ color: "var(--on-surface-variant)", lineHeight: 1.6 }}>지정 소스에서 &quot;가져올 기사&quot;를 <b>기본 키워드가 들어간 기사</b>로 정한 소스는 제목에 아래 키워드가 하나라도 있는 기사만 수집합니다. 배포 없이 바로 반영돼요.</p>
                <div className="flex gap-2 mb-3">
                  <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFocusKeyword()} placeholder="예: MICE, 스마트관광, AX" className="flex-1 h-8 px-3 rounded-md text-sm outline-none" style={inputStyle} />
                  <button onClick={addFocusKeyword} disabled={!newKeyword.trim() || savingKeywords} className="h-8 px-4 rounded-md text-sm font-semibold disabled:opacity-40" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>추가</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {focusKeywords.length === 0 && <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>등록된 키워드가 없습니다.</span>}
                  {focusKeywords.map((kw) => (
                    <span key={kw} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)" }}>
                      {kw}
                      <button onClick={() => saveFocusKeywords(focusKeywords.filter((k) => k !== kw))} className="flex items-center justify-center" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}><XIcon size={11} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {kwDialog.open && <KeywordDialog initial={kwDialog.initial} categories={categories} onClose={() => setKwDialog({ open: false })} onSaved={() => { setKwDialog({ open: false }); void load(); }} />}
      {srcDialog.open && <SourceDialog initial={srcDialog.initial} categories={categories} focusKeywords={focusKeywords} onClose={() => setSrcDialog({ open: false })} onSaved={() => { setSrcDialog({ open: false }); void load(); }} />}

      <HelpPanel title="수집 소스 가이드" open={helpOpen} onOpenChange={setHelpOpen}>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--on-surface-variant)" }}>뉴스 큐레이션이 기사를 가져오는 곳을 관리합니다. 화·목 정기 실행 때 켜진 소스를 모두 확인합니다.</p>
        <Section n={1} title="검색 키워드">
          <Item text="키워드 하나로 네이버뉴스와 구글뉴스를 함께 검색합니다. 같은 기사가 둘 다 잡히면 한 건으로 합쳐요." />
          <Item text="카테고리는 직접 정합니다. 같은 기사가 다른 카테고리의 키워드 두 개에 걸리면 AI가 내용을 보고 판단해요." />
        </Section>
        <Section n={2} title="지정 소스">
          <Def term="RSS">주소만 알면 됩니다.</Def>
          <Def term="웹페이지 목록">기사 목록 페이지에서 링크를 찾아옵니다. JavaScript로 목록을 그리는 사이트는 렌더링 서비스를 자동으로 거쳐요.</Def>
          <Def term="JSON API">게시판 데이터 주소를 쓰는 사이트. 고급 설정에서 목록 위치와 기사 링크 형식을 지정합니다.</Def>
          <Item text="주소를 붙여넣고 [확인]을 누르면 방식을 자동으로 찾고 최근 기사를 미리 보여줍니다. 기사를 찾아야만 저장할 수 있어요." />
        </Section>
        <Section n={3} title="가져올 기사">
          <Item text="전체: 거르지 않음 / 기본 키워드: 아래 관심 키워드가 제목에 있는 기사 / 지정 키워드: 이 소스만의 키워드" />
          <Item text="카테고리를 '섞여 있음'으로 하면 AI가 기사마다 MICE·TOURISM·AI 중 하나로 판단합니다." />
        </Section>
        <Section n={4} title="최근 수집 상태">
          <Def term="정상">최근 실행에서 기사를 수집</Def>
          <Def term="0건 / N회 연속 0건">응답은 왔는데 기사가 없음. 3회 연속이면 주소·구조 변경을 확인하세요.</Def>
          <Def term="오류">주소가 막혔거나(401·403) 사라졌거나(404) 연결 실패</Def>
        </Section>
      </HelpPanel>
    </div>
  );
}
