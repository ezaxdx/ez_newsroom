"use client";

import { useState } from "react";
import { Plus, X, Sparkles, Save } from "lucide-react";
import { ALL_CATEGORIES, DEFAULT_NAV_CATEGORIES } from "@/lib/config";

type CategorySetting = {
  audience: string;
  persona: string;
  keywords: string[];
};

type SettingsMap = Record<string, CategorySetting>;

const CATEGORIES = [...ALL_CATEGORIES];

const PRESETS: Record<string, { label: string; prompt: string }[]> = {
  AI: [
    { label: "AI 리서처", prompt: "이 뉴스를 AI 기술 리서처의 관점에서 분석해줘. 기술 실현 가능성, 산업 적용 가능성, 데이터 파이프라인 측면을 중심으로 시사점을 도출해." },
    { label: "AI 스타트업 창업자", prompt: "이 뉴스를 AI 스타트업 창업자의 관점에서 분석해줘. 시장 진입 타이밍, 차별화 포인트, 자본 효율성 측면의 인사이트를 제공해." },
  ],
  MICE: [
    { label: "MICE 기획자", prompt: "이 뉴스를 MICE 행사 기획자의 관점에서 분석해줘. 운영 효율, 참가자 경험, 비용 최적화 측면에서 실질적인 시사점을 도출해." },
    { label: "컨벤션 센터 운영자", prompt: "이 뉴스를 컨벤션 센터 운영자의 관점에서 분석해줘. 공간 활용률, 운영 자동화, 서비스 품질 측면에서 적용 가능한 인사이트를 제공해." },
  ],
  TOURISM: [
    { label: "관광 스타트업 대표", prompt: "이 뉴스를 관광 스타트업 대표의 관점에서 분석해줘. 시장 기회, 경쟁 우위, 투자 유치 가능성 측면을 중심으로 해석해." },
    { label: "지자체 관광 담당자", prompt: "이 뉴스를 지자체 관광 담당자의 관점에서 분석해줘. 방문객 유치 전략, 체류시간 연장, 지역 경제 파급 효과 측면의 시사점을 도출해." },
  ],
  STARTUP: [
    { label: "초기 창업자", prompt: "이 뉴스를 초기 스타트업 창업자의 관점에서 분석해줘. 린 스타트업 방식의 적용 가능성, 빠른 실험 전략, 투자자 관심 포인트를 중심으로 해석해." },
    { label: "VC 심사역", prompt: "이 뉴스를 VC 심사역의 관점에서 분석해줘. 시장 크기, 팀 역량 요건, 투자 리스크 요인을 중심으로 평가해줘." },
  ],
  POLICY: [
    { label: "정책 연구원", prompt: "이 뉴스를 정책 연구원의 관점에서 분석해줘. 규제 동향, 정부 지원 방향, 산업 영향력 측면의 시사점을 도출해." },
  ],
  OPERATIONS: [
    { label: "운영 관리자", prompt: "이 뉴스를 운영 관리자의 관점에서 분석해줘. 프로세스 효율화, 비용 절감, 품질 개선 적용 방안을 중심으로 해석해." },
  ],
  INDUSTRY: [
    { label: "업계 애널리스트", prompt: "이 뉴스를 업계 애널리스트의 관점에서 분석해줘. 시장 트렌드, 경쟁 구도 변화, 중장기 산업 전망을 중심으로 인사이트를 제공해." },
  ],
};

const DEFAULT_SETTINGS: SettingsMap = {
  AI:         { audience: "AI 기술 전문가 및 스타트업",   persona: PRESETS.AI[0].prompt,         keywords: ["AI", "LLM", "자동화", "데이터"] },
  MICE:       { audience: "MICE 행사 기획자 및 운영자",   persona: PRESETS.MICE[0].prompt,       keywords: ["MICE", "컨벤션", "운영 비용", "참가자"] },
  TOURISM:    { audience: "관광 스타트업 및 지자체",       persona: PRESETS.TOURISM[0].prompt,    keywords: ["관광", "체류시간", "OTA", "야간관광"] },
  STARTUP:    { audience: "스타트업 창업자 및 투자자",     persona: PRESETS.STARTUP[0].prompt,    keywords: ["스타트업", "투자", "성장", "B2B"] },
  POLICY:     { audience: "정책 담당자 및 연구원",         persona: PRESETS.POLICY[0].prompt,     keywords: ["정책", "규제", "지원", "공공"] },
  OPERATIONS: { audience: "현장 운영 관리자",             persona: PRESETS.OPERATIONS[0].prompt, keywords: ["운영", "효율", "자동화", "비용"] },
  INDUSTRY:   { audience: "업계 종사자 및 미디어",         persona: PRESETS.INDUSTRY[0].prompt,   keywords: ["트렌드", "시장", "경쟁", "성장"] },
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("AI");
  const [settings, setSettings] = useState<SettingsMap>(DEFAULT_SETTINGS);
  const [newKeyword, setNewKeyword] = useState("");
  const [savedTab, setSavedTab] = useState<string | null>(null);
  const [navCategories, setNavCategories] = useState<string[]>([...DEFAULT_NAV_CATEGORIES]);
  const [carouselSec, setCarouselSec] = useState(5);
  const [navSaved, setNavSaved] = useState(false);

  const toggleNavCategory = (cat: string) => {
    setNavCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const saveNavCategories = async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: existing } = await supabase
        .from("curation_settings")
        .select("id")
        .limit(1)
        .single();
      if (existing?.id) {
        await supabase
          .from("curation_settings")
          .update({ nav_categories: navCategories, carousel_interval_sec: carouselSec })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("curation_settings")
          .insert({ nav_categories: navCategories, carousel_interval_sec: carouselSec });
      }
    } catch { /* fallback: no Supabase */ }
    setNavSaved(true);
    setTimeout(() => setNavSaved(false), 2000);
  };

  const current = settings[activeTab];

  const update = (patch: Partial<CategorySetting>) =>
    setSettings((prev) => ({ ...prev, [activeTab]: { ...prev[activeTab], ...patch } }));

  const addKeyword = () => {
    const k = newKeyword.trim();
    if (!k || current.keywords.includes(k)) return;
    update({ keywords: [...current.keywords, k] });
    setNewKeyword("");
  };

  const removeKeyword = (k: string) =>
    update({ keywords: current.keywords.filter((kw) => kw !== k) });

  const handleSave = async () => {
    await new Promise((r) => setTimeout(r, 500));
    setSavedTab(activeTab);
    setTimeout(() => setSavedTab(null), 2000);
  };

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight m-0">큐레이션 설정</h2>
        <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
          카테고리별로 AI 페르소나, 타겟 독자, 강조 키워드를 독립적으로 설정합니다
        </p>
      </div>

      {/* ── 네비게이션 카테고리 관리 ── */}
      <div className="p-5 rounded-lg mb-8 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
        <div>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5"
            style={{ color: "var(--on-surface-variant)" }}>
            상단 네비게이션 카테고리
          </p>
          <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
            뉴스룸 상단에 표시할 카테고리를 선택합니다
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const active = navCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleNavCategory(cat)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide uppercase transition-all"
                style={{
                  background: active ? "var(--primary)" : "var(--surface-container-highest)",
                  color: active ? "#fff" : "var(--on-surface-variant)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {active && <span style={{ fontSize: "0.6rem" }}>✓</span>}
                {cat}
              </button>
            );
          })}
        </div>
        {/* Carousel interval */}
        <div className="flex items-center gap-3 pt-1" style={{ borderTop: "1px solid var(--surface-container-high)" }}>
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--on-surface-variant)" }}>
            <span className="font-semibold">히어로 롤링 간격</span>
            <input
              type="number"
              min={2}
              max={60}
              value={carouselSec}
              onChange={(e) => setCarouselSec(Math.max(2, Math.min(60, Number(e.target.value))))}
              className="w-16 h-7 px-2 rounded-md text-xs text-center outline-none"
              style={{
                background: "var(--surface-container-highest)",
                border: "1px solid var(--surface-container-high)",
                color: "var(--on-surface)",
              }}
            />
            <span>초</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveNavCategories}
            className="flex items-center gap-2 h-8 px-4 rounded-md text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: navSaved ? "#16a34a" : "var(--primary)", color: "#fff" }}
          >
            <Save size={12} />
            {navSaved ? "저장됨 ✓" : "저장"}
          </button>
          <p className="text-[0.68rem] m-0" style={{ color: "var(--on-surface-variant)" }}>
            현재 선택: {navCategories.join(", ") || "없음"}
          </p>
        </div>
      </div>

      {/* Category tabs */}
      <div
        className="flex gap-0.5 mb-6 p-1 rounded-lg overflow-x-auto"
        style={{ background: "var(--surface-container-highest)" }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => { setActiveTab(cat); setNewKeyword(""); }}
            className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide uppercase transition-all"
            style={{
              background: activeTab === cat ? "var(--surface-container-lowest)" : "transparent",
              color: activeTab === cat ? "var(--on-surface)" : "var(--on-surface-variant)",
              boxShadow: activeTab === cat ? "0 1px 4px rgba(26,28,29,0.07)" : "none",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Settings panel */}
      <div className="flex flex-col gap-5">

        {/* Audience */}
        <div className="p-5 rounded-lg flex flex-col gap-3" style={{ background: "var(--surface-container-lowest)" }}>
          <label className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase" style={{ color: "var(--on-surface-variant)" }}>
            타겟 독자
          </label>
          <input
            value={current.audience}
            onChange={(e) => update({ audience: e.target.value })}
            className="h-9 px-3 rounded-md text-sm outline-none"
            style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
          />
        </div>

        {/* AI Persona */}
        <div className="p-5 rounded-lg flex flex-col gap-3" style={{ background: "var(--surface-container-lowest)" }}>
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: "var(--on-surface-variant)" }} />
            <label className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase" style={{ color: "var(--on-surface-variant)" }}>
              AI 페르소나 프롬프트
            </label>
          </div>

          {/* Presets for this category */}
          {PRESETS[activeTab] && (
            <div className="flex gap-2 flex-wrap">
              {PRESETS[activeTab].map(({ label, prompt }) => (
                <button
                  key={label}
                  onClick={() => update({ persona: prompt })}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: current.persona === prompt ? "var(--primary)" : "var(--surface-container-highest)",
                    color: current.persona === prompt ? "#fff" : "var(--on-surface-variant)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={current.persona}
            onChange={(e) => update({ persona: e.target.value })}
            rows={5}
            className="px-3 py-2.5 rounded-md text-sm outline-none resize-none leading-relaxed"
            style={{
              background: "var(--surface-container-low)",
              border: "1px solid transparent",
              color: "var(--on-surface)",
              fontFamily: "inherit",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
          />
          <p className="text-[0.7rem] m-0" style={{ color: "var(--on-surface-variant)" }}>
            이 프롬프트가 <strong>{activeTab}</strong> 카테고리 기사의 "Expert Insight" 생성에 사용됩니다.
          </p>
        </div>

        {/* Keywords */}
        <div className="p-5 rounded-lg flex flex-col gap-3" style={{ background: "var(--surface-container-lowest)" }}>
          <label className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase" style={{ color: "var(--on-surface-variant)" }}>
            강조 키워드
          </label>
          <div className="flex flex-wrap gap-2">
            {current.keywords.map((kw) => (
              <span
                key={kw}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
                style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)" }}
              >
                {kw}
                <button
                  onClick={() => removeKeyword(kw)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  <X size={12} style={{ color: "var(--on-surface-variant)" }} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addKeyword()}
              placeholder="키워드 입력 후 Enter"
              className="h-8 flex-1 px-3 rounded-md text-sm outline-none"
              style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
            />
            <button
              onClick={addKeyword}
              className="h-8 w-8 flex items-center justify-center rounded-md"
              style={{ background: "var(--surface-container-highest)" }}
            >
              <Plus size={14} style={{ color: "var(--on-surface)" }} />
            </button>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className="self-start flex items-center gap-2 h-10 px-6 rounded-md text-sm font-semibold transition-all hover:opacity-80"
          style={{
            background: savedTab === activeTab ? "#16a34a" : "var(--primary)",
            color: "#fff",
          }}
        >
          <Save size={14} />
          {savedTab === activeTab ? `${activeTab} 저장됨 ✓` : `${activeTab} 설정 저장`}
        </button>
      </div>
    </div>
  );
}
