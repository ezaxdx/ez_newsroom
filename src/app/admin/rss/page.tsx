"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Rss, Link, Database, Mail, Pencil, Check, X as XIcon } from "lucide-react";
import HelpPanel from "@/components/admin/HelpPanel";
import { RssSource, ApiConfig, GmailConfig } from "@/lib/types";

const EMPTY_API_CONFIG: ApiConfig = {
  endpoint: "",
  service_key_env: "TOURAPI_SERVICE_KEY",
  params: { numOfRows: "10", pageNo: "1", MobileOS: "ETC", MobileApp: "MonolithBot", baseYm: "auto", _type: "json" },
  data_path: "response.body.items.item",
  context_hint: "",
};

const EMPTY_GMAIL_CONFIG: GmailConfig = {
  sender_filter: "",
  subject_filter: "",
  max_emails: 3,
};

const EMPTY_FORM = {
  url: "",
  source_name: "",
  weight: 3,
  default_category: "AI",
  source_type: "rss" as "rss" | "url" | "api" | "gmail",
  api_config: EMPTY_API_CONFIG as ApiConfig | GmailConfig,
  keyword_filter: false,
};

const TYPE_META = {
  rss: {
    label: "RSS 피드",
    icon: Rss,
    bg: "var(--surface-container-highest)",
    color: "var(--on-surface-variant)",
    placeholder: "https://example.com/feed.xml",
    hint: "RSS/Atom 피드 URL. 소스당 최대 10개 기사를 자동 수집합니다. 언론사 전체 피드는 '키워드 필터'를 켜면 관심 기사만 수집됩니다.",
  },
  url: {
    label: "직접 URL",
    icon: Link,
    bg: "var(--primary)",
    color: "#fff",
    placeholder: "https://example.com/article",
    hint: "개별 기사 URL. 큐레이션 실행 시 해당 페이지를 직접 분석해 기사 1건을 생성합니다.",
  },
  api: {
    label: "공공 API",
    icon: Database,
    bg: "#0891b2",
    color: "#fff",
    placeholder: "https://apis.data.go.kr/B551011/AreaTarDivService",
    hint: "JSON REST API. 응답 데이터를 분석해 기사를 생성합니다. (한국관광공사 등 공공데이터 API 지원)",
  },
  gmail: {
    label: "Gmail 뉴스레터",
    icon: Mail,
    bg: "#ea4335",
    color: "#fff",
    placeholder: "gmail://yozm-it",
    hint: "Gmail로 수신한 뉴스레터에서 기사를 자동 수집합니다. 먼저 관리자 > 뉴스레터 > Gmail 연동에서 인증을 완료하세요.",
  },
};

// 가중치 3단계 (내부값: 큐레이션 품질점수 가산에 사용)
const WEIGHT_TIERS = [
  { label: "중요", value: 8 },
  { label: "보통", value: 5 },
  { label: "낮음", value: 2 },
] as const;
function weightLabel(w: number): string {
  return w >= 7 ? "중요" : w >= 4 ? "보통" : "낮음";
}

export default function RssPage() {
  const [sources, setSources] = useState<RssSource[]>([]);
  const [categories, setCategories] = useState<string[]>(["AI", "MICE", "TOURISM"]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAdvancedTypes, setShowAdvancedTypes] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ── 초기 로드 ──
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/rss").then((r) => r.json()),
      fetch("/api/admin/categories").then((r) => r.json()),
    ]).then(([rssData, catData]) => {
      setSources(rssData.data ?? []);
      setCategories(catData.categories ?? ["AI", "MICE", "TOURISM"]);
    }).finally(() => setLoading(false));
  }, []);

  // ── 토글 ──
  const toggleActive = async (source: RssSource) => {
    setSources((prev) => prev.map((s) => s.id === source.id ? { ...s, is_active: !s.is_active } : s));
    await fetch("/api/admin/rss", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, is_active: !source.is_active }),
    });
  };

  // ── 삭제 ──
  const remove = async (id: string) => {
    if (!confirm("이 소스를 삭제할까요?")) return;
    setSources((prev) => prev.filter((s) => s.id !== id));
    await fetch("/api/admin/rss", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  // ── 추가 ──
  const addSource = async () => {
    if (!form.url || !form.source_name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, is_active: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSources((prev) => [...prev, json.data]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e) {
      alert("추가 실패: " + (e instanceof Error ? e.message : "오류"));
    } finally {
      setSaving(false);
    }
  };

  // 카테고리 필터
  const [filterCat, setFilterCat] = useState("ALL");
  const allCats = ["ALL", ...Array.from(new Set(sources.map((s) => s.default_category))).sort()];
  // 카테고리 필터 + 활성 우선 + weight 높은 순
  const activeFirst = (a: { is_active: boolean; weight: number }, b: { is_active: boolean; weight: number }) =>
    Number(b.is_active) - Number(a.is_active) || (b.weight ?? 0) - (a.weight ?? 0);
  const filteredSources = (filterCat === "ALL" ? sources : sources.filter((s) => s.default_category === filterCat))
    .slice().sort(activeFirst);

  const meta = TYPE_META[form.source_type];

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0">RSS 소스 매니저</h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            RSS 피드와 개별 기사 URL을 함께 관리합니다
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          <Plus size={14} /> 소스 추가
        </button>
      </div>

      {/* ── 추가 폼 ── */}
      {showForm && (
        <div
          className="p-5 rounded-lg mb-6 flex flex-col gap-4"
          style={{ background: "var(--surface-container-lowest)", boxShadow: "0 2px 12px rgba(26,28,29,0.06)" }}
        >
          <h3 className="text-sm font-semibold m-0">새 소스 등록</h3>

          {/* 유형 선택 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
              소스 유형
            </label>
            <div className="flex gap-2 flex-wrap items-center">
              {/* 기본 유형(rss/url) + 고급 시 api/gmail 노출 */}
              {(showAdvancedTypes
                ? (["rss", "url", "api", "gmail"] as const)
                : (["rss", "url"] as const)
              ).map((type) => {
                const m = TYPE_META[type];
                const Icon = m.icon;
                const isSelected = form.source_type === type;
                return (
                  <button
                    key={type}
                    onClick={() => setForm((f) => ({
                      ...f,
                      source_type: type,
                      url: type === "gmail" ? `gmail://${f.source_name.toLowerCase().replace(/\s+/g, "-") || "newsletter"}` : "",
                      api_config: type === "gmail" ? EMPTY_GMAIL_CONFIG : EMPTY_API_CONFIG,
                    }))}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      background: isSelected ? m.bg : "var(--surface-container-low)",
                      color: isSelected ? m.color : "var(--on-surface-variant)",
                      border: `1.5px solid ${isSelected ? m.bg : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    <Icon size={13} />
                    {m.label}
                  </button>
                );
              })}
              {!showAdvancedTypes && (
                <button
                  onClick={() => setShowAdvancedTypes(true)}
                  className="text-xs px-2 py-2"
                  style={{ background: "transparent", border: "none", color: "var(--on-surface-variant)", cursor: "pointer", textDecoration: "underline" }}
                >
                  + 고급 (API·Gmail)
                </button>
              )}
            </div>
            <p className="text-[0.7rem] m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
              {meta.hint}
            </p>
          </div>

          {/* 입력 필드 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                {form.source_type === "rss" ? "RSS URL" : form.source_type === "api" ? "API Base URL" : form.source_type === "gmail" ? "식별자 (자동 입력됨)" : "기사 URL"}
              </label>
              <input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder={meta.placeholder}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>소스명</label>
              <input
                value={form.source_name}
                onChange={(e) => setForm((f) => ({ ...f, source_name: e.target.value }))}
                placeholder={form.source_type === "rss" ? "TechCrunch" : "기사 제목 또는 출처"}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>기본 카테고리</label>
              <select
                value={form.default_category}
                onChange={(e) => setForm((f) => ({ ...f, default_category: e.target.value }))}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
              >
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                중요도
              </label>
              <div className="flex gap-1.5 mt-1">
                {WEIGHT_TIERS.map((t) => {
                  const on = weightLabel(form.weight) === t.label;
                  return (
                    <button key={t.label}
                      onClick={() => setForm((f) => ({ ...f, weight: t.value }))}
                      className="flex-1 h-8 rounded-md text-xs font-semibold transition-colors"
                      style={{
                        background: on ? "var(--primary)" : "var(--surface-container-low)",
                        color: on ? "#fff" : "var(--on-surface-variant)",
                        border: "none", cursor: "pointer",
                      }}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 키워드 필터 (RSS 전용) */}
          {form.source_type === "rss" && (
            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.keyword_filter}
                onChange={(e) => setForm((f) => ({ ...f, keyword_filter: e.target.checked }))}
                className="mt-0.5"
              />
              <span className="text-xs" style={{ color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
                <b style={{ color: "var(--on-surface)" }}>키워드 필터 적용</b> — 언론사 전체 뉴스 피드처럼 주제가 섞인 소스에 켜세요.
                제목에 관심 키워드(큐레이션 설정)가 있는 기사만 수집합니다. 구글뉴스·블로그처럼 이미 주제가 좁은 소스는 끄세요.
              </span>
            </label>
          )}

          {/* Gmail 전용 설정 */}
          {form.source_type === "gmail" && (
            <div className="flex flex-col gap-3 p-4 rounded-lg" style={{ background: "var(--surface-container-low)" }}>
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide m-0" style={{ color: "#ea4335" }}>
                Gmail 설정
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    발신자 이메일 <span style={{ color: "#ea4335" }}>*</span>
                  </label>
                  <input
                    value={(form.api_config as GmailConfig).sender_filter}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...(f.api_config as GmailConfig), sender_filter: e.target.value } }))}
                    placeholder="admin@wishket.com"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#ea4335")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    제목 키워드 필터 (선택)
                  </label>
                  <input
                    value={(form.api_config as GmailConfig).subject_filter ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...(f.api_config as GmailConfig), subject_filter: e.target.value } }))}
                    placeholder="요즘IT"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#ea4335")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    최대 이메일 수 ({(form.api_config as GmailConfig).max_emails}개)
                  </label>
                  <input
                    type="range" min={1} max={10} value={(form.api_config as GmailConfig).max_emails}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...(f.api_config as GmailConfig), max_emails: Number(e.target.value) } }))}
                    className="mt-2"
                  />
                </div>
              </div>
              <p className="text-[0.65rem] m-0" style={{ color: "var(--on-surface-variant)" }}>
                최근 7일 이내 수신된 이메일에서 기사 링크를 추출합니다.
                <a href="/admin/gmail" style={{ color: "#ea4335", marginLeft: 6 }}>Gmail 연동 상태 확인 →</a>
              </p>
            </div>
          )}

          {/* API 전용 추가 설정 */}
          {form.source_type === "api" && (() => {
            const apiCfg = form.api_config as ApiConfig;
            return (
            <div className="flex flex-col gap-3 p-4 rounded-lg" style={{ background: "var(--surface-container-low)" }}>
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide m-0" style={{ color: "#0891b2" }}>
                API 설정
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    엔드포인트 (Endpoint)
                  </label>
                  <input
                    value={apiCfg.endpoint}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...f.api_config, endpoint: e.target.value } }))}
                    placeholder="/areaTouDivList"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#0891b2")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    서비스키 환경변수명
                  </label>
                  <input
                    value={apiCfg.service_key_env}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...f.api_config, service_key_env: e.target.value } }))}
                    placeholder="TOURAPI_SERVICE_KEY"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#0891b2")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    응답 데이터 경로
                  </label>
                  <input
                    value={apiCfg.data_path}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...f.api_config, data_path: e.target.value } }))}
                    placeholder="response.body.items.item"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#0891b2")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                    기사 맥락 설명
                  </label>
                  <input
                    value={apiCfg.context_hint}
                    onChange={(e) => setForm((f) => ({ ...f, api_config: { ...f.api_config, context_hint: e.target.value } }))}
                    placeholder="지역별 관광객 연령대 다양성 데이터"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#0891b2")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                  추가 파라미터 (JSON) — baseYm: "auto" 입력 시 전월 자동 적용
                </label>
                <textarea
                  rows={3}
                  value={JSON.stringify(apiCfg.params, null, 2)}
                  onChange={(e) => {
                    try { setForm((f) => ({ ...f, api_config: { ...f.api_config, params: JSON.parse(e.target.value) } })); }
                    catch { /* invalid JSON, ignore */ }
                  }}
                  className="px-3 py-2 rounded-md text-xs outline-none font-mono"
                  style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)", resize: "vertical" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#0891b2")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                />
              </div>
            </div>
            );
          })()}

          <div className="flex gap-2 pt-1">
            <button
              onClick={addSource}
              disabled={
                saving || !form.source_name ||
                (form.source_type !== "gmail" && !form.url) ||
                (form.source_type === "api" && "endpoint" in form.api_config && !form.api_config.endpoint) ||
                (form.source_type === "gmail" && !(form.api_config as GmailConfig).sender_filter)
              }
              className="flex items-center gap-2 h-8 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              추가
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="h-8 px-4 rounded-md text-sm font-medium"
              style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* ── 카테고리 필터 ── */}
      {!loading && sources.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {allCats.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className="px-3 py-1 rounded-full text-[0.7rem] font-semibold tracking-wide uppercase transition-colors"
              style={{
                background: filterCat === cat ? "var(--primary)" : "var(--surface-container-highest)",
                color: filterCat === cat ? "#fff" : "var(--on-surface-variant)",
                border: "none", cursor: "pointer",
              }}
            >
              {cat}
              {cat !== "ALL" && (
                <span className="ml-1 opacity-70">
                  {sources.filter((s) => s.default_category === cat).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── 소스 목록 ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--on-surface-variant)" }} />
        </div>
      ) : sources.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm rounded-lg"
          style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
          등록된 소스가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredSources.map((source) => (
            <SourceCard key={source.id} source={source} categories={categories} onToggle={toggleActive} onRemove={remove} onUpdate={(s) => setSources((prev) => prev.map((p) => p.id === s.id ? s : p))} />
          ))}
        </div>
      )}

      <HelpPanel title="RSS 소스 매니저 가이드">
        <p style={{ marginBottom: 12 }}>
          콘텐츠 수집 소스를 등록·관리합니다. 등록된 소스는 큐레이션 실행 시 자동으로 수집됩니다.
        </p>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>소스 타입</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>RSS 피드</strong> — URL 등록 시 최신 기사 최대 10개 자동 수집 (언론사 전체 피드는 키워드 필터 권장)</li>
          <li><strong style={{ color: "var(--on-surface)" }}>직접 URL</strong> — 특정 기사 1건만 분석·등록</li>
          <li><strong style={{ color: "var(--on-surface)" }}>Gmail 뉴스레터</strong> — 발신자 이메일 기반 자동 파싱</li>
          <li><strong style={{ color: "var(--on-surface)" }}>공공 API</strong> — 한국관광공사 등 공공데이터 연동</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>중요도</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>중요/보통/낮음 — 높을수록 품질 점수에 가산</li>
          <li>공고·홍보성 소스는 낮음, 분석·인사이트 소스는 중요로 설정 권장</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>활성/비활성</p>
        <ul style={{ paddingLeft: 16 }}>
          <li>토글 OFF 시 큐레이션에서 해당 소스 건너뜀</li>
          <li>소스를 삭제하지 않고 임시 중단할 때 활용</li>
        </ul>
      </HelpPanel>
    </div>
  );
}

/* ── 소스 카드 컴포넌트 ── */
function SourceCard({
  source,
  categories,
  onToggle,
  onRemove,
  onUpdate,
}: {
  source: RssSource;
  categories: string[];
  onToggle: (s: RssSource) => void;
  onRemove: (id: string) => void;
  onUpdate: (s: RssSource) => void;
}) {
  const type = (source.source_type ?? "rss") as "rss" | "url" | "api" | "gmail";
  const Icon = TYPE_META[type].icon;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    source_name: source.source_name,
    url: source.url,
    default_category: source.default_category,
    weight: source.weight,
    keyword_filter: source.keyword_filter ?? false,
  });

  // 중요도(weight)는 편집 폼에서만 수정 — 인라인 표시용 값
  const [weight, setWeight] = useState(source.weight);

  const saveEdit = async () => {
    setSaving(true);
    await fetch("/api/admin/rss", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, ...editForm }),
    });
    setSaving(false);
    setEditing(false);
    setWeight(editForm.weight);
    onUpdate({ ...source, ...editForm });
  };

  return (
    <div
      className="rounded-lg transition-opacity"
      style={{ background: "var(--surface-container-lowest)", opacity: source.is_active ? 1 : 0.5 }}
    >
      {/* ── 편집 폼 ── */}
      {editing && (
        <div className="p-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>소스명</label>
              <input
                value={editForm.source_name}
                onChange={(e) => setEditForm((f) => ({ ...f, source_name: e.target.value }))}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>URL</label>
              <input
                value={editForm.url}
                onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>카테고리</label>
              <select
                value={editForm.default_category}
                onChange={(e) => setEditForm((f) => ({ ...f, default_category: e.target.value }))}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
              >
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>중요도</label>
              <div className="flex gap-1.5 mt-1">
                {WEIGHT_TIERS.map((t) => {
                  const on = weightLabel(editForm.weight) === t.label;
                  return (
                    <button key={t.label}
                      onClick={() => setEditForm((f) => ({ ...f, weight: t.value }))}
                      className="flex-1 h-8 rounded-md text-xs font-semibold transition-colors"
                      style={{ background: on ? "var(--primary)" : "var(--surface-container-low)", color: on ? "#fff" : "var(--on-surface-variant)", border: "none", cursor: "pointer" }}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {type === "rss" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.keyword_filter}
                onChange={(e) => setEditForm((f) => ({ ...f, keyword_filter: e.target.checked }))}
              />
              <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>
                <b style={{ color: "var(--on-surface)" }}>키워드 필터</b> — 관심 키워드 매칭 기사만 수집 (언론사 전체 피드용)
              </span>
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex items-center gap-1.5 h-8 px-4 rounded-md text-sm font-semibold"
              style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              저장
            </button>
            <button
              onClick={() => { setEditing(false); setEditForm({ source_name: source.source_name, url: source.url, default_category: source.default_category, weight: source.weight, keyword_filter: source.keyword_filter ?? false }); }}
              className="h-8 px-4 rounded-md text-sm font-medium"
              style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* ── 카드 기본 뷰 ── */}
      <div className="flex items-center gap-4 p-4">
      {/* 유형 아이콘 */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
        style={{ background: TYPE_META[type].bg }}
      >
        <Icon size={13} style={{ color: TYPE_META[type].color }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-semibold text-sm m-0">{editForm.source_name}</p>
          <span className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase"
            style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
            {editForm.default_category}
          </span>
          {source.keyword_filter && (
            <span className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide"
              style={{ background: "#2563eb18", color: "#2563eb" }}
              title="관심 키워드 매칭 기사만 수집">
              🔍 키워드필터
            </span>
          )}
        </div>
        <a
          href={editForm.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs truncate block transition-opacity hover:opacity-60"
          style={{ color: "var(--on-surface-variant)", textDecoration: "none", maxWidth: "38ch" }}
          title={editForm.url}
        >
          {editForm.url}{type === "api" && source.api_config && "endpoint" in source.api_config ? source.api_config.endpoint : ""}
        </a>
        {type === "api" && source.api_config && "context_hint" in source.api_config && source.api_config.context_hint && (
          <p className="text-[0.65rem] m-0 mt-0.5 truncate" style={{ color: "#0891b2", maxWidth: "38ch" }}>
            {source.api_config.context_hint}
          </p>
        )}
      </div>

      {/* 중요도 배지 (수정은 편집 버튼에서) */}
      <div className="flex-shrink-0">
        <span className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide"
          style={{
            background: weight >= 7 ? "var(--primary)" : "var(--surface-container-highest)",
            color: weight >= 7 ? "#fff" : "var(--on-surface-variant)",
          }}>
          {weightLabel(weight)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => { setEditing(!editing); setEditForm({ source_name: source.source_name, url: source.url, default_category: source.default_category, weight: source.weight, keyword_filter: source.keyword_filter ?? false }); }}
          className="p-1.5 rounded transition-colors"
          title="수정"
          style={{ background: editing ? "var(--surface-container-highest)" : "transparent", border: "none", cursor: "pointer" }}
        >
          <Pencil size={14} style={{ color: editing ? "var(--primary)" : "var(--on-surface-variant)" }} />
        </button>
        <button onClick={() => onToggle(source)} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          {source.is_active
            ? <ToggleRight size={20} style={{ color: "var(--primary)" }} />
            : <ToggleLeft size={20} style={{ color: "var(--on-surface-variant)" }} />}
        </button>
        <button onClick={() => onRemove(source.id)} className="p-1.5 rounded"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          <Trash2 size={14} style={{ color: "#dc2626" }} />
        </button>
      </div>
    </div>
    </div>
  );
}
