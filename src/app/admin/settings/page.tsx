"use client";

import { useState, useEffect } from "react";
import { Plus, X, Sparkles, Save, Loader2, ChevronLeft, ChevronRight, Check, ToggleLeft, ToggleRight } from "lucide-react";

type Preset = { label: string; prompt: string };

type CategorySetting = {
  audience: string;
  persona: string;
  keywords: string[];
  presets: Preset[]; // 카테고리별 커스텀 프리셋
};
type SettingsMap = Record<string, CategorySetting>;
type LevelPrompts = { Beginner: string; Intermediate: string; Advanced: string };
type CategoryLevelPrompts = Record<string, LevelPrompts>;

const DEFAULT_LEVEL_PROMPTS: LevelPrompts = {
  Beginner: "배경지식이 없는 독자도 이해할 수 있도록 쉽게 작성하세요. 전문 용어는 반드시 쉬운 말로 풀어서 설명하고, '이것이 무엇인지'부터 설명한 후 시사점을 제시하세요. 문장은 짧고 명확하게 유지하세요.",
  Intermediate: "업계 기본 지식을 갖춘 실무 담당자를 대상으로 작성하세요. 전문 용어를 자연스럽게 사용하되, What보다 Why와 How에 집중해 실행 가능한 시사점을 중심으로 분석하세요.",
  Advanced: "깊은 전문성을 갖춘 전략가와 의사결정자를 위해 작성하세요. 표면적 사실보다 시장 구조 변화, 2차·3차 파급효과, 경쟁 구도 변화를 중심으로 심층 분석하세요. 전문 용어와 데이터를 적극 활용하세요.",
};

const LEVEL_BADGE: Record<string, { bg: string; color: string }> = {
  Beginner: { bg: "var(--surface-container-highest)", color: "var(--on-surface-variant)" },
  Intermediate: { bg: "rgba(26,28,29,0.75)", color: "#fff" },
  Advanced: { bg: "var(--primary)", color: "#fff" },
};

// 기존 하드코딩 프리셋 → 마이그레이션 시 사용
const LEGACY_PRESETS: Record<string, Preset[]> = {
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
};

function makeDefault(cat: string): CategorySetting {
  return {
    audience: `${cat} 업계 종사자`,
    persona: `당신은 ${cat} 전문 에디터입니다. 업계 종사자 관점에서 핵심 시사점을 분석합니다.`,
    keywords: [],
    presets: LEGACY_PRESETS[cat] ?? [],
  };
}

function calcScheduleWindow(days: number[]): number {
  if (!days || days.length <= 1) return 7;
  const sorted = [...days].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    maxGap = Math.max(maxGap, sorted[i + 1] - sorted[i]);
  }
  maxGap = Math.max(maxGap, sorted[0] + 7 - sorted[sorted.length - 1]);
  return maxGap;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [navCategories, setNavCategories] = useState<string[]>(["AI", "MICE", "TOURISM"]);
  const [carouselSec, setCarouselSec] = useState(5);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [levelPrompts, setLevelPrompts] = useState<CategoryLevelPrompts>({});
  const [activeTab, setActiveTab] = useState("AI");
  const [autoSchedule, setAutoSchedule] = useState<{ enabled: boolean; days: number[]; hour: number }>({ enabled: false, days: [], hour: 9 });
  const [qualityThresholds, setQualityThresholds] = useState({ auto_publish: 8, staging: 5 });

  const [newCat, setNewCat] = useState("");
  const [newKeyword, setNewKeyword] = useState("");

  // 프리셋 추가 폼 상태
  const [addingPreset, setAddingPreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newPresetPrompt, setNewPresetPrompt] = useState("");

  /* ── DB 로드 ── */
  useEffect(() => {
    fetch("/api/admin/categories")
      .then((r) => r.json())
      .then((d) => {
        const cats: string[] = d.categories ?? ["AI", "MICE", "TOURISM"];
        setNavCategories(cats);
        setCarouselSec(d.carouselSec ?? 5);
        setActiveTab(cats[0] ?? "AI");
        setAutoSchedule(d.autoSchedule ?? { enabled: false, days: [], hour: 9 });
        setQualityThresholds(d.qualityThresholds ?? { auto_publish: 8, staging: 5 });

        const savedSettings: SettingsMap = d.categorySettings ?? {};
        const merged: SettingsMap = {};
        for (const cat of cats) {
          const base = savedSettings[cat] ?? makeDefault(cat);
          // presets 필드가 없는 구버전 데이터 마이그레이션
          merged[cat] = {
            ...base,
            presets: base.presets ?? LEGACY_PRESETS[cat] ?? [],
          };
        }
        setSettings(merged);

        // 레벨 프롬프트 로드 (구버전 전역 형식 마이그레이션)
        const rawLp = d.levelPrompts ?? {};
        if (rawLp["초급"] || rawLp["중급"] || rawLp["고급"] || rawLp["Beginner"] || rawLp["Intermediate"] || rawLp["Advanced"]) {
          const migrated: CategoryLevelPrompts = {};
          for (const cat of cats) {
            migrated[cat] = {
              Beginner: rawLp["Beginner"] ?? rawLp["초급"] ?? DEFAULT_LEVEL_PROMPTS["Beginner"],
              Intermediate: rawLp["Intermediate"] ?? rawLp["중급"] ?? DEFAULT_LEVEL_PROMPTS["Intermediate"],
              Advanced: rawLp["Advanced"] ?? rawLp["고급"] ?? DEFAULT_LEVEL_PROMPTS["Advanced"],
            };
          }
          setLevelPrompts(migrated);
        } else {
          setLevelPrompts(rawLp as CategoryLevelPrompts);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  /* ── 카테고리 추가 ── */
  const addCategory = () => {
    const cat = newCat.trim().toUpperCase();
    if (!cat || navCategories.includes(cat)) return;
    setNavCategories((prev) => [...prev, cat]);
    setSettings((prev) => ({ ...prev, [cat]: makeDefault(cat) }));
    setLevelPrompts((prev) => ({ ...prev, [cat]: { ...DEFAULT_LEVEL_PROMPTS } }));
    setActiveTab(cat);
    setNewCat("");
  };

  /* ── 카테고리 삭제 ── */
  const removeCategory = (cat: string) => {
    if (navCategories.length <= 1) { alert("카테고리는 최소 1개 필요합니다."); return; }
    if (!confirm(`"${cat}" 카테고리를 삭제할까요?`)) return;
    setNavCategories((prev) => prev.filter((c) => c !== cat));
    if (activeTab === cat) setActiveTab(navCategories.find((c) => c !== cat) ?? "");
  };

  /* ── 현재 탭 설정 헬퍼 ── */
  const current = settings[activeTab] ?? makeDefault(activeTab);
  const update = (patch: Partial<CategorySetting>) =>
    setSettings((prev) => ({ ...prev, [activeTab]: { ...(prev[activeTab] ?? makeDefault(activeTab)), ...patch } }));

  /* ── 키워드 ── */
  const addKeyword = () => {
    const k = newKeyword.trim();
    if (!k || current.keywords.includes(k)) return;
    update({ keywords: [...current.keywords, k] });
    setNewKeyword("");
  };
  const moveKeyword = (idx: number, dir: -1 | 1) => {
    const kws = [...current.keywords];
    const next = idx + dir;
    if (next < 0 || next >= kws.length) return;
    [kws[idx], kws[next]] = [kws[next], kws[idx]];
    update({ keywords: kws });
  };

  /* ── 프리셋 ── */
  const addPreset = () => {
    const label = newPresetLabel.trim();
    const prompt = newPresetPrompt.trim();
    if (!label || !prompt) return;
    update({ presets: [...(current.presets ?? []), { label, prompt }] });
    setNewPresetLabel("");
    setNewPresetPrompt("");
    setAddingPreset(false);
  };
  const removePreset = (idx: number) => {
    update({ presets: current.presets.filter((_, i) => i !== idx) });
  };

  /* ── 레벨 프롬프트 ── */
  const currentLevelPrompts: LevelPrompts = levelPrompts[activeTab] ?? DEFAULT_LEVEL_PROMPTS;
  const updateLevelPrompt = (lv: keyof LevelPrompts, val: string) =>
    setLevelPrompts((prev) => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? DEFAULT_LEVEL_PROMPTS), [lv]: val },
    }));

  /* ── 전체 저장 ── */
  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: navCategories, carouselSec, categorySettings: settings, levelPrompts, autoSchedule, qualityThresholds }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
      alert("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin" style={{ color: "var(--on-surface-variant)" }} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0">큐레이션 설정</h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            카테고리 추가/삭제 후 저장하면 뉴스룸 전체에 반영됩니다
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 h-9 px-5 rounded-md text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
          style={{ background: saved ? "#16a34a" : "var(--primary)", color: "#fff" }}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? "저장 중..." : saved ? "저장됨 ✓" : "전체 저장"}
        </button>
      </div>

      {/* ── 카테고리 관리 ── */}
      <div className="p-5 rounded-lg mb-8 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5"
              style={{ color: "var(--on-surface-variant)" }}>
              상단 네비게이션 카테고리
            </p>
            <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
              추가/삭제 후 전체 저장을 눌러야 반영됩니다
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              placeholder="새 카테고리명"
              className="h-8 px-3 rounded-md text-sm outline-none w-32"
              style={{ background: "var(--surface-container-low)", border: "1px solid var(--surface-container-high)", color: "var(--on-surface)" }}
            />
            <button
              onClick={addCategory}
              className="flex items-center gap-1 h-8 px-3 rounded-md text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              <Plus size={13} /> 추가
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {navCategories.map((cat) => (
            <span key={cat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide uppercase"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              {cat}
              <button onClick={() => removeCategory(cat)}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: 0.8 }}>
                <X size={11} color="#fff" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid var(--surface-container-high)" }}>
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--on-surface-variant)" }}>
            <span className="font-semibold">히어로 롤링 간격</span>
            <input
              type="number" min={2} max={60} value={carouselSec}
              onChange={(e) => setCarouselSec(Math.max(2, Math.min(60, Number(e.target.value))))}
              className="w-16 h-7 px-2 rounded-md text-xs text-center outline-none"
              style={{ background: "var(--surface-container-highest)", border: "1px solid var(--surface-container-high)", color: "var(--on-surface)" }}
            />
            <span>초</span>
          </label>
        </div>
      </div>

      {/* ── 자동 큐레이션 스케줄 ── */}
      <div className="p-5 rounded-lg mb-8 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5" style={{ color: "var(--on-surface-variant)" }}>
              자동 큐레이션 스케줄
            </p>
            <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
              {autoSchedule.enabled
                ? `자동 큐레이션 실행 중 · 메인 노출 기간 ${calcScheduleWindow(autoSchedule.days)}일`
                : "설정한 요일·시각에 자동으로 AI 큐레이션이 실행됩니다"}
            </p>
          </div>
          {/* ON/OFF 토글 */}
          <button
            onClick={() => setAutoSchedule((s) => ({ ...s, enabled: !s.enabled }))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={{
              background: autoSchedule.enabled ? "rgba(26,28,29,0.08)" : "transparent",
              border: "none",
              cursor: "pointer",
              color: autoSchedule.enabled ? "var(--on-surface)" : "var(--on-surface-variant)",
            }}
          >
            {autoSchedule.enabled
              ? <ToggleRight size={22} style={{ color: "var(--primary)" }} />
              : <ToggleLeft size={22} style={{ color: "var(--on-surface-variant)" }} />}
            {autoSchedule.enabled ? "ON" : "OFF"}
          </button>
        </div>

        {autoSchedule.enabled && (
          <div className="flex flex-col gap-3">
            {/* 요일 선택 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                실행 요일
              </label>
              <div className="flex gap-2">
                {[{ label: "일", val: 0 }, { label: "월", val: 1 }, { label: "화", val: 2 }, { label: "수", val: 3 }, { label: "목", val: 4 }, { label: "금", val: 5 }, { label: "토", val: 6 }].map(({ label, val }) => {
                  const isOn = autoSchedule.days.includes(val);
                  return (
                    <button
                      key={val}
                      onClick={() => setAutoSchedule((s) => ({
                        ...s,
                        days: isOn ? s.days.filter((d) => d !== val) : [...s.days, val].sort(),
                      }))}
                      className="w-9 h-9 rounded-full text-xs font-bold transition-all"
                      style={{
                        background: isOn ? "var(--primary)" : "var(--surface-container-highest)",
                        color: isOn ? "#fff" : "var(--on-surface-variant)",
                        border: "none", cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 시각 선택 */}
            <div className="flex items-center gap-2">
              <label className="text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--on-surface-variant)" }}>
                실행 시각 (KST)
              </label>
              <select
                value={autoSchedule.hour}
                onChange={(e) => setAutoSchedule((s) => ({ ...s, hour: Number(e.target.value) }))}
                className="h-8 px-3 rounded-md text-sm outline-none"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)" }}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── 자동 발행 퀄리티 기준 ── */}
      <div className="p-5 rounded-lg mb-8 flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
        <div>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5" style={{ color: "var(--on-surface-variant)" }}>
            자동 발행 퀄리티 기준
          </p>
          <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
            AI가 생성한 기사의 퀄리티 점수(1~10)에 따라 자동 처리됩니다
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* 자동 발행 */}
          <div className="p-3 rounded-lg text-center" style={{ background: "rgba(26,28,29,0.08)" }}>
            <p className="text-[0.65rem] font-semibold uppercase m-0 mb-1" style={{ color: "var(--on-surface-variant)" }}>자동 발행</p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-lg font-bold" style={{ color: "var(--on-surface)" }}>{qualityThresholds.auto_publish}</span>
              <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>점 이상</span>
            </div>
            <input type="range" min={6} max={10} value={qualityThresholds.auto_publish}
              onChange={(e) => setQualityThresholds((t) => ({ ...t, auto_publish: Math.max(Number(e.target.value), t.staging + 1) }))}
              className="w-full mt-2" />
          </div>
          {/* 대기열 */}
          <div className="p-3 rounded-lg text-center" style={{ background: "rgba(26,28,29,0.08)" }}>
            <p className="text-[0.65rem] font-semibold uppercase m-0 mb-1" style={{ color: "var(--on-surface-variant)" }}>대기열</p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-lg font-bold" style={{ color: "var(--on-surface)" }}>{qualityThresholds.staging}~{qualityThresholds.auto_publish - 1}</span>
              <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>점</span>
            </div>
            <input type="range" min={3} max={8} value={qualityThresholds.staging}
              onChange={(e) => setQualityThresholds((t) => ({ ...t, staging: Math.min(Number(e.target.value), t.auto_publish - 1) }))}
              className="w-full mt-2" />
          </div>
          {/* 자동 삭제 */}
          <div className="p-3 rounded-lg text-center" style={{ background: "rgba(26,28,29,0.08)" }}>
            <p className="text-[0.65rem] font-semibold uppercase m-0 mb-1" style={{ color: "var(--on-surface-variant)" }}>자동 삭제</p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-lg font-bold" style={{ color: "var(--on-surface)" }}>{qualityThresholds.staging - 1}</span>
              <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>점 이하</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 카테고리별 설정 탭 ── */}
      {navCategories.length > 0 && (
        <>
          <div className="flex gap-0.5 mb-6 p-1 rounded-lg overflow-x-auto"
            style={{ background: "var(--surface-container-highest)" }}>
            {navCategories.map((cat) => (
              <button key={cat}
                onClick={() => { setActiveTab(cat); setNewKeyword(""); setAddingPreset(false); }}
                className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide uppercase transition-all"
                style={{
                  background: activeTab === cat ? "var(--surface-container-lowest)" : "transparent",
                  color: activeTab === cat ? "var(--on-surface)" : "var(--on-surface-variant)",
                  boxShadow: activeTab === cat ? "0 1px 4px rgba(26,28,29,0.07)" : "none",
                  border: "none", cursor: "pointer",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-5">

            {/* 타겟 독자 */}
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

            {/* AI 페르소나 */}
            <div className="p-5 rounded-lg flex flex-col gap-3" style={{ background: "var(--surface-container-lowest)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} style={{ color: "var(--on-surface-variant)" }} />
                  <label className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase" style={{ color: "var(--on-surface-variant)" }}>
                    AI 페르소나 프롬프트
                  </label>
                </div>
              </div>

              {/* 프리셋 칩 목록 + 추가 버튼 */}
              <div className="flex flex-wrap gap-2 items-center">
                {(current.presets ?? []).map((preset, idx) => (
                  <div key={idx} className="flex items-center gap-0 rounded-full overflow-hidden"
                    style={{ background: current.persona === preset.prompt ? "var(--primary)" : "var(--surface-container-highest)" }}>
                    <button
                      onClick={() => update({ persona: preset.prompt })}
                      className="px-3 py-1.5 text-xs font-semibold transition-colors"
                      style={{
                        background: "transparent",
                        color: current.persona === preset.prompt ? "#fff" : "var(--on-surface-variant)",
                        border: "none", cursor: "pointer",
                      }}
                    >
                      {preset.label}
                    </button>
                    <button
                      onClick={() => removePreset(idx)}
                      className="pr-2 pl-0.5 flex items-center transition-opacity hover:opacity-100"
                      style={{
                        background: "transparent", border: "none", cursor: "pointer",
                        opacity: current.persona === preset.prompt ? 0.7 : 0.45,
                      }}
                      title="프리셋 삭제"
                    >
                      <X size={11} style={{ color: current.persona === preset.prompt ? "#fff" : "var(--on-surface-variant)" }} />
                    </button>
                  </div>
                ))}

                {/* 프리셋 추가 버튼 */}
                {!addingPreset && (
                  <button
                    onClick={() => setAddingPreset(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "var(--surface-container-high)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}
                  >
                    <Plus size={11} /> 프리셋 추가
                  </button>
                )}
              </div>

              {/* 프리셋 추가 인라인 폼 */}
              {addingPreset && (
                <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "var(--surface-container-low)", border: "1px solid var(--surface-container-highest)" }}>
                  <input
                    value={newPresetLabel}
                    onChange={(e) => setNewPresetLabel(e.target.value)}
                    placeholder="버튼 라벨 (예: MICE 전략가)"
                    className="h-8 px-3 rounded-md text-sm outline-none"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                    autoFocus
                  />
                  <textarea
                    value={newPresetPrompt}
                    onChange={(e) => setNewPresetPrompt(e.target.value)}
                    placeholder="이 프리셋을 클릭하면 채워질 페르소나 프롬프트를 작성하세요"
                    rows={3}
                    className="px-3 py-2 rounded-md text-sm outline-none resize-none leading-relaxed"
                    style={{ background: "var(--surface-container-lowest)", border: "1px solid transparent", color: "var(--on-surface)", fontFamily: "inherit" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setAddingPreset(false); setNewPresetLabel(""); setNewPresetPrompt(""); }}
                      className="h-7 px-3 rounded-md text-xs font-semibold"
                      style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}
                    >
                      취소
                    </button>
                    <button
                      onClick={addPreset}
                      disabled={!newPresetLabel.trim() || !newPresetPrompt.trim()}
                      className="flex items-center gap-1 h-7 px-3 rounded-md text-xs font-semibold disabled:opacity-40"
                      style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
                    >
                      <Check size={11} /> 추가
                    </button>
                  </div>
                </div>
              )}

              <textarea
                value={current.persona}
                onChange={(e) => update({ persona: e.target.value })}
                rows={5}
                className="px-3 py-2.5 rounded-md text-sm outline-none resize-none leading-relaxed"
                style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)", fontFamily: "inherit" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
              />
              <p className="text-[0.7rem] m-0" style={{ color: "var(--on-surface-variant)" }}>
                이 프롬프트가 <strong>{activeTab}</strong> 카테고리 기사의 AI 생성에 사용됩니다.
              </p>
            </div>

            {/* 강조 키워드 */}
            <div className="p-5 rounded-lg flex flex-col gap-3" style={{ background: "var(--surface-container-lowest)" }}>
              <label className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase" style={{ color: "var(--on-surface-variant)" }}>
                강조 키워드
              </label>
              <div className="flex flex-wrap gap-2">
                {current.keywords.map((kw, idx) => (
                  <span key={kw}
                    className="flex items-center gap-0.5 pl-2 pr-1.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)" }}
                  >
                    <button onClick={() => moveKeyword(idx, -1)} disabled={idx === 0}
                      style={{ background: "transparent", border: "none", cursor: idx === 0 ? "default" : "pointer", padding: "0 1px", display: "flex", opacity: idx === 0 ? 0.25 : 0.6 }}
                      title="왼쪽으로">
                      <ChevronLeft size={12} />
                    </button>
                    <span className="px-1">{kw}</span>
                    <button onClick={() => moveKeyword(idx, 1)} disabled={idx === current.keywords.length - 1}
                      style={{ background: "transparent", border: "none", cursor: idx === current.keywords.length - 1 ? "default" : "pointer", padding: "0 1px", display: "flex", opacity: idx === current.keywords.length - 1 ? 0.25 : 0.6 }}
                      title="오른쪽으로">
                      <ChevronRight size={12} />
                    </button>
                    <button onClick={() => update({ keywords: current.keywords.filter((k) => k !== kw) })}
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 1px", display: "flex" }}
                      title="삭제">
                      <X size={11} style={{ color: "var(--on-surface-variant)" }} />
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
                <button onClick={addKeyword}
                  className="h-8 w-8 flex items-center justify-center rounded-md"
                  style={{ background: "var(--surface-container-highest)", border: "none", cursor: "pointer" }}>
                  <Plus size={14} style={{ color: "var(--on-surface)" }} />
                </button>
              </div>
            </div>

            {/* 레벨별 AI 작성 지침 */}
            <div className="p-5 rounded-lg flex flex-col gap-4" style={{ background: "var(--surface-container-lowest)" }}>
              <div>
                <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-0.5"
                  style={{ color: "var(--on-surface-variant)" }}>
                  레벨별 AI 작성 지침
                </p>
                <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>
                  <strong>{activeTab}</strong> 카테고리 기사 생성 시 레벨별로 적용되는 문체·관점 지침입니다.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {(["Beginner", "Intermediate", "Advanced"] as const).map((lv) => (
                  <div key={lv} className="flex flex-col gap-2">
                    <span
                      className="self-start px-2.5 py-0.5 rounded-full text-[0.62rem] font-bold tracking-[0.05em] uppercase"
                      style={{ background: LEVEL_BADGE[lv].bg, color: LEVEL_BADGE[lv].color }}
                    >
                      {lv}
                    </span>
                    <textarea
                      value={currentLevelPrompts[lv]}
                      onChange={(e) => updateLevelPrompt(lv, e.target.value)}
                      rows={3}
                      className="px-3 py-2.5 rounded-md text-sm outline-none resize-none leading-relaxed"
                      style={{ background: "var(--surface-container-low)", border: "1px solid transparent", color: "var(--on-surface)", fontFamily: "inherit" }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                    />
                  </div>
                ))}
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}
