"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Rss, Link, Database, Mail, Pencil, Check, X as XIcon } from "lucide-react";
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
};

const TYPE_META = {
  rss: {
    label: "RSS 피드",
    icon: Rss,
    bg: "var(--surface-container-highest)",
    color: "var(--on-surface-variant)",
    placeholder: "https://example.com/feed.xml",
    hint: "RSS/Atom 피드 URL. 소스당 최대 3개 기사를 자동 수집합니다.",
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
    hint: "Gmail로 수신한 뉴스레터에서 기사를 자동 수집합니다. 먼저 /admin/gmail 에서 Gmail 인증을 완료하세요.",
  },
};

export default function RssPage() {
  const [sources, setSources] = useState<RssSource[]>([]);
  const [categories, setCategories] = useState<string[]>(["AI", "MICE", "TOURISM"]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
  const filteredSources = filterCat === "ALL" ? sources : sources.filter((s) => s.default_category === filterCat);

  // 유형별 소스 분리 (필터 적용)
  const rssSources = filteredSources.filter((s) => (s.source_type ?? "rss") === "rss");
  const urlSources = filteredSources.filter((s) => s.source_type === "url");
  const apiSources = filteredSources.filter((s) => s.source_type === "api");
  const gmailSources = filteredSources.filter((s) => s.source_type === "gmail");

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
            <div className="flex gap-2 flex-wrap">
              {(["rss", "url", "api", "gmail"] as const).map((type) => {
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
                신뢰도 가중치 ({form.weight})
              </label>
              <input
                type="range" min={1} max={10} value={form.weight}
                onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))}
                className="w-full mt-2"
              />
            </div>
          </div>

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
        <div className="flex flex-col gap-8">
          {/* RSS 피드 섹션 */}
          {rssSources.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Rss size={13} style={{ color: "var(--on-surface-variant)" }} />
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
                  style={{ color: "var(--on-surface-variant)" }}>
                  RSS 피드 <span className="ml-1 opacity-60">({rssSources.length})</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {rssSources.map((source) => (
                  <SourceCard key={source.id} source={source} categories={categories} onToggle={toggleActive} onRemove={remove} onUpdate={(s) => setSources((prev) => prev.map((p) => p.id === s.id ? s : p))} />
                ))}
              </div>
            </section>
          )}

          {/* 직접 URL 섹션 */}
          {urlSources.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Link size={13} style={{ color: "var(--on-surface-variant)" }} />
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
                  style={{ color: "var(--on-surface-variant)" }}>
                  직접 URL <span className="ml-1 opacity-60">({urlSources.length})</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {urlSources.map((source) => (
                  <SourceCard key={source.id} source={source} categories={categories} onToggle={toggleActive} onRemove={remove} onUpdate={(s) => setSources((prev) => prev.map((p) => p.id === s.id ? s : p))} />
                ))}
              </div>
            </section>
          )}

          {/* 공공 API 섹션 */}
          {apiSources.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Database size={13} style={{ color: "#0891b2" }} />
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
                  style={{ color: "#0891b2" }}>
                  공공 API <span className="ml-1 opacity-60">({apiSources.length})</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {apiSources.map((source) => (
                  <SourceCard key={source.id} source={source} categories={categories} onToggle={toggleActive} onRemove={remove} onUpdate={(s) => setSources((prev) => prev.map((p) => p.id === s.id ? s : p))} />
                ))}
              </div>
            </section>
          )}

          {/* Gmail 뉴스레터 섹션 */}
          {gmailSources.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Mail size={13} style={{ color: "#ea4335" }} />
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
                  style={{ color: "#ea4335" }}>
                  Gmail 뉴스레터 <span className="ml-1 opacity-60">({gmailSources.length})</span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {gmailSources.map((source) => (
                  <SourceCard key={source.id} source={source} categories={categories} onToggle={toggleActive} onRemove={remove} onUpdate={(s) => setSources((prev) => prev.map((p) => p.id === s.id ? s : p))} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
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
  });

  // 가중치 단독 편집 제거 (전체 편집으로 통합)
  const [editingWeight, setEditingWeight] = useState(false);
  const [weight, setWeight] = useState(source.weight);
  const [savingWeight, setSavingWeight] = useState(false);

  const saveWeight = async () => {
    if (weight === source.weight) { setEditingWeight(false); return; }
    setSavingWeight(true);
    await fetch("/api/admin/rss", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, weight }),
    });
    setSavingWeight(false);
    setEditingWeight(false);
    onUpdate({ ...source, weight });
  };

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
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                가중치 ({editForm.weight})
              </label>
              <input
                type="range" min={1} max={10} value={editForm.weight}
                onChange={(e) => setEditForm((f) => ({ ...f, weight: Number(e.target.value) }))}
                className="mt-2"
              />
            </div>
          </div>
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
              onClick={() => { setEditing(false); setEditForm({ source_name: source.source_name, url: source.url, default_category: source.default_category, weight: source.weight }); }}
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

      {/* 가중치 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {editingWeight ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--on-surface-variant)" }}>가중치</span>
            <input
              type="range" min={1} max={10} value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="w-20"
              autoFocus
            />
            <span className="text-xs font-bold w-4">{weight}</span>
            <button
              onClick={saveWeight}
              disabled={savingWeight}
              className="h-6 px-2 rounded text-[0.65rem] font-semibold"
              style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              {savingWeight ? "..." : "저장"}
            </button>
            <button
              onClick={() => { setEditingWeight(false); setWeight(source.weight); }}
              className="h-6 px-2 rounded text-[0.65rem] font-semibold"
              style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingWeight(true)}
            className="flex items-center gap-2 transition-opacity hover:opacity-70"
            style={{ background: "transparent", border: "none", cursor: "pointer" }}
            title="클릭해서 가중치 변경"
          >
            <span className="text-xs font-medium" style={{ color: "var(--on-surface-variant)" }}>가중치</span>
            <div className="flex gap-0.5">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="w-1.5 h-4 rounded-sm"
                  style={{ background: i < weight ? "var(--primary)" : "var(--surface-container-highest)" }} />
              ))}
            </div>
            <span className="text-xs font-bold w-4">{weight}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => { setEditing(!editing); setEditForm({ source_name: source.source_name, url: source.url, default_category: source.default_category, weight: source.weight }); }}
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
