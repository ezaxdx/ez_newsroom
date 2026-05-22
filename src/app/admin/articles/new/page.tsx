"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Loader2, Sparkles, PenLine, ExternalLink, CheckCircle2 } from "lucide-react";
import HelpPanel from "@/components/admin/HelpPanel";

type Tab = "ai" | "manual";

type ArticleFields = {
  title: string;
  summary_short: string;
  content_long: string;
  implications: string;
  image_url: string;
  original_url: string;
  category: string;
  level: string;
};

const EMPTY: ArticleFields = {
  title: "",
  summary_short: "",
  content_long: "",
  implications: "",
  image_url: "",
  original_url: "",
  category: "AI",
  level: "Intermediate",
};

/* ── Shared field editor ── */
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;

function Fields({
  fields,
  onChange,
  categories = ["AI", "MICE", "TOURISM"],
}: {
  fields: ArticleFields;
  onChange: (f: Partial<ArticleFields>) => void;
  categories?: string[];
}) {
  const inputStyle = {
    background: "var(--surface-container-lowest)",
    border: "1px solid var(--surface-container-high)",
    borderRadius: "6px",
    color: "var(--on-surface)",
    padding: "10px 12px",
    fontSize: "0.875rem",
    width: "100%",
    outline: "none",
    boxSizing: "border-box" as const,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        {/* Category */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
            카테고리
          </span>
          <select
            value={fields.category}
            onChange={(e) => onChange({ category: e.target.value })}
            style={inputStyle}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        {/* Level */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
            레벨
          </span>
          <select
            value={fields.level}
            onChange={(e) => onChange({ level: e.target.value })}
            style={inputStyle}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>

        {/* Original URL */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
            원문 URL
          </span>
          <input
            type="url"
            value={fields.original_url}
            onChange={(e) => onChange({ original_url: e.target.value })}
            placeholder="https://..."
            style={inputStyle}
          />
        </label>
      </div>

      {/* Title */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
          제목
        </span>
        <input
          type="text"
          value={fields.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="기사 제목"
          style={inputStyle}
        />
      </label>

      {/* Summary */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
          요약
        </span>
        <textarea
          rows={3}
          value={fields.summary_short}
          onChange={(e) => onChange({ summary_short: e.target.value })}
          placeholder="2~3문장 요약"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>

      {/* Content */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
          상세 내용
        </span>
        <textarea
          rows={6}
          value={fields.content_long}
          onChange={(e) => onChange({ content_long: e.target.value })}
          placeholder="상세 분석 내용"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>

      {/* Implications */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
          시사점 (Implications)
        </span>
        <textarea
          rows={3}
          value={fields.implications}
          onChange={(e) => onChange({ implications: e.target.value })}
          placeholder="업계 담당자를 위한 실행 가능한 인사이트"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>

      {/* Image URL */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--on-surface-variant)" }}>
          이미지 URL (선택)
        </span>
        <input
          type="url"
          value={fields.image_url}
          onChange={(e) => onChange({ image_url: e.target.value })}
          placeholder="https://..."
          style={inputStyle}
        />
      </label>
    </div>
  );
}

/* ── Main page ── */
export default function NewArticlePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("ai");
  const [fields, setFields] = useState<ArticleFields>({ ...EMPTY });
  const [categories, setCategories] = useState<string[]>(["AI", "MICE", "TOURISM"]);

  useEffect(() => {
    fetch("/api/admin/categories")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? ["AI", "MICE", "TOURISM"]))
      .catch(console.error);
  }, []);

  // AI tab state
  const [aiUrl, setAiUrl] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiGenerated, setAiGenerated] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const update = (partial: Partial<ArticleFields>) =>
    setFields((prev) => ({ ...prev, ...partial }));

  async function handleGenerate() {
    if (!aiUrl.trim()) return;
    setAiLoading(true);
    setAiError("");
    setAiGenerated(false);
    try {
      const res = await fetch("/api/generate-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: aiUrl.trim(), category: fields.category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error ?? "생성 실패");
      setFields((prev) => ({
        ...prev,
        title: data.title ?? prev.title,
        summary_short: data.summary_short ?? prev.summary_short,
        content_long: data.content_long ?? prev.content_long,
        implications: data.implications ?? prev.implications,
        image_url: data.image_url ?? prev.image_url,
        original_url: data.original_url ?? prev.original_url,
        category: data.category ?? prev.category,
      }));
      setAiGenerated(true);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "오류 발생");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSave(publish: boolean) {
    if (!fields.title.trim()) { setSaveError("제목을 입력해주세요."); return; }
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/save-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, is_published: publish }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      setSaved(true);
      setTimeout(() => router.push("/admin"), 1200);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    background: "var(--surface-container-lowest)",
    border: "1px solid var(--surface-container-high)",
    borderRadius: "6px",
    color: "var(--on-surface)",
    padding: "10px 12px",
    fontSize: "0.875rem",
    outline: "none",
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[0.7rem] font-semibold tracking-[0.06em] uppercase m-0 mb-1"
          style={{ color: "var(--on-surface-variant)" }}>
          Editorial Control
        </p>
        <h1 className="text-2xl font-bold tracking-tight m-0">기사 작성</h1>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-8 p-1 rounded-lg w-fit"
        style={{ background: "var(--surface-container-low)" }}
      >
        {(["ai", "manual"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: tab === t ? "var(--surface)" : "transparent",
              color: tab === t ? "var(--on-surface)" : "var(--on-surface-variant)",
              border: "none",
              cursor: "pointer",
              boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}
          >
            {t === "ai" ? <Sparkles size={14} /> : <PenLine size={14} />}
            {t === "ai" ? "AI 자동 생성" : "수동 작성"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-8">
        {/* AI URL input (only on AI tab, before generation) */}
        {tab === "ai" && (
          <div
            className="p-5 rounded-xl flex flex-col gap-4"
            style={{ background: "var(--surface-container-low)" }}
          >
            <div>
              <p className="m-0 font-semibold text-sm">원문 URL 입력</p>
              <p className="m-0 text-xs mt-1" style={{ color: "var(--on-surface-variant)" }}>
                URL을 입력하면 AI가 원문을 분석해 제목·요약·시사점을 자동으로 작성합니다.
              </p>
            </div>

            <div className="flex gap-2">
              <select
                value={fields.category}
                onChange={(e) => update({ category: e.target.value })}
                style={{ ...inputStyle, flexShrink: 0 }}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <input
                type="url"
                value={aiUrl}
                onChange={(e) => setAiUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="https://..."
                style={{ ...inputStyle, flex: 1 }}
              />

              <button
                onClick={handleGenerate}
                disabled={aiLoading || !aiUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-opacity"
                style={{
                  background: "var(--primary)",
                  color: "var(--on-primary)",
                  border: "none",
                  cursor: aiLoading || !aiUrl.trim() ? "not-allowed" : "pointer",
                  opacity: aiLoading || !aiUrl.trim() ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {aiLoading ? "생성 중..." : "AI 생성"}
              </button>
            </div>

            {aiUrl && (
              <a
                href={aiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs w-fit hover:underline"
                style={{ color: "var(--on-surface-variant)" }}
              >
                <ExternalLink size={11} /> 원문 미리보기
              </a>
            )}

            {aiError && (
              <p className="m-0 text-xs px-3 py-2 rounded-md"
                style={{ background: "#fee2e2", color: "#dc2626" }}>
                {aiError}
              </p>
            )}

            {aiGenerated && (
              <p className="m-0 text-xs flex items-center gap-1.5"
                style={{ color: "#16a34a" }}>
                <CheckCircle2 size={13} /> AI 생성 완료 — 아래에서 내용을 검토·수정하세요.
              </p>
            )}
          </div>
        )}

        {/* Fields — always visible; on AI tab show after first generation attempt or always for review */}
        {(tab === "manual" || aiGenerated || fields.title) && (
          <div
            className="p-5 rounded-xl"
            style={{ background: "var(--surface-container-low)" }}
          >
            <p className="m-0 font-semibold text-sm mb-4">
              {tab === "ai" ? "내용 검토 및 수정" : "기사 내용 작성"}
            </p>
            <Fields fields={fields} onChange={update} categories={categories} />
          </div>
        )}

        {/* Save actions */}
        {(tab === "manual" || aiGenerated || fields.title) && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave(false)}
              disabled={saving || saved}
              className="h-10 px-5 rounded-md text-sm font-semibold transition-opacity"
              style={{
                background: "var(--surface-container-highest)",
                color: "var(--on-surface)",
                border: "none",
                cursor: saving || saved ? "not-allowed" : "pointer",
                opacity: saving || saved ? 0.6 : 1,
              }}
            >
              임시저장 (스테이징)
            </button>

            <button
              onClick={() => handleSave(true)}
              disabled={saving || saved}
              className="h-10 px-5 rounded-md text-sm font-semibold transition-opacity"
              style={{
                background: "var(--primary)",
                color: "var(--on-primary)",
                border: "none",
                cursor: saving || saved ? "not-allowed" : "pointer",
                opacity: saving || saved ? 0.6 : 1,
              }}
            >
              {saving ? "저장 중..." : saved ? "저장 완료 ✓" : "바로 발행"}
            </button>

            {saveError && (
              <p className="m-0 text-xs" style={{ color: "#dc2626" }}>{saveError}</p>
            )}
          </div>
        )}
      </div>

      <HelpPanel title="기사 작성 가이드">
        <p style={{ marginBottom: 12 }}>
          AI 자동 생성 또는 직접 작성으로 기사를 개별 등록합니다.
        </p>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>AI 생성 탭</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>기사 URL 입력 시 Gemini가 제목·요약·분석·시사점 자동 생성</li>
          <li>생성 후 내용 직접 수정 가능</li>
          <li>카테고리·레벨 선택 후 대기 저장 또는 즉시 발행</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>직접 작성 탭</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>제목, 요약(120자 이내), 본문, 시사점 수동 입력</li>
          <li>이미지 URL, 원문 URL 선택 입력</li>
          <li>대기 상태로 저장하거나 즉시 발행 선택 가능</li>
        </ul>
        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>레벨 기준</p>
        <ul style={{ paddingLeft: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>Beginner</strong> — 업계 입문자, 배경지식 없이 이해 가능</li>
          <li><strong style={{ color: "var(--on-surface)" }}>Intermediate</strong> — 실무 담당자, 기본 지식 보유자</li>
          <li><strong style={{ color: "var(--on-surface)" }}>Advanced</strong> — 전략·기획자, 심층 분석 대상</li>
        </ul>
      </HelpPanel>
    </div>
  );
}
