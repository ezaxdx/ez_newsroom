"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { NewsItem } from "@/lib/types";
import type { RssSource } from "@/app/admin/quality/page";
import HelpPanel from "@/components/admin/HelpPanel";

type EventRow = {
  id: string;
  event_name: string;
  venue: string;
  venue_region: string | null;
  category: string | null;
  organizer: string | null;
  start_date: string;
  end_date: string | null;
  website: string | null;
  is_published: boolean;
  created_at: string;
};

type Props = { news: NewsItem[]; events: EventRow[]; sources: RssSource[] };

// ── EZPMP 사업 영역 정의 (docs/ezpmp_promotion_ai_reference_260519.md 기준) ─────
const DOMAINS: { label: string; color: string; keywords: string[] }[] = [
  {
    label: "스마트립",
    color: "#0ea5e9",
    keywords: [
      "스마트 관광", "관광 DX", "지역 관광", "맞춤형 여행", "관광 데이터",
      "체류형 관광", "로컬 콘텐츠", "지자체 관광", "관광 앱", "방문객 경험",
      "지역 상권", "SMARTRIP", "스마트립",
      "여행 플랫폼", "여행 앱", "숙박 플랫폼", "호텔 기술", "여행 테크",
    ],
  },
  {
    label: "글로컬 관광",
    color: "#10b981",
    keywords: [
      "글로컬", "글로벌 관광객", "다국어 관광", "로컬 브랜딩", "K-관광",
      "지역 체류", "국제행사 연계", "관광 스토리텔링", "지역 상생",
      "외래 관광객", "인바운드", "해외 관광객", "관광 브랜딩",
    ],
  },
  {
    label: "AI 관광",
    color: "#6366f1",
    keywords: [
      "AI 관광", "관광 챗봇", "개인화 추천", "여행 AI", "다국어 안내",
      "관광 데이터 분석", "스마트 관광 안내", "생성형 AI", "관광 운영 자동화",
      "여행 일정 추천", "AI 안내", "관광 AI", "여행 추천 AI",
    ],
  },
  {
    label: "MICE Tech",
    color: "#f59e0b",
    keywords: [
      "MICE", "마이스", "O2MEET", "LeadX", "리드엑스", "행사 자동화",
      "전시 DX", "비즈니스 매칭", "하이브리드 행사", "컨벤션", "전시회",
      "박람회", "PCO", "컨퍼런스", "포럼", "행사 플랫폼", "SaaS", "CSAP",
      "이벤트 테크", "행사 기획", "전시 기획", "세미나 운영", "엑스포 운영",
    ],
  },
  {
    label: "ATT(관광 전시)",
    color: "#ec4899",
    keywords: [
      "All That Travel", "ATT", "관광 박람회", "관광 비즈니스", "관광 산업",
      "여행 트렌드", "관광 스타트업", "관광 네트워킹", "관광 B2B", "관광 체험",
      "지역 관광 홍보", "관광 엑스포", "여행 박람회",
    ],
  },
  {
    label: "MEeT(의료 전시)",
    color: "#ef4444",
    keywords: [
      "MEeT", "Medical Emerging Technology", "의료기술", "디지털헬스",
      "의료기기", "헬스케어", "바이오", "메디컬 테크", "의료 컨퍼런스",
      "의료 전시", "글로벌 바이어", "투자 매칭", "의료", "healthcare",
      "헬스테크", "의료 AI", "바이오테크", "디지털 의료",
    ],
  },
  {
    label: "AXDX",
    color: "#8b5cf6",
    keywords: [
      "AXDX", "인공지능", "AI 솔루션", "AI 서비스", "AI 에이전트", "AI 플랫폼",
      "AI 기업", "AI 스타트업", "AI 도입", "AI 활용", "AI 개발", "AI 투자",
      "AI 모델", "OpenAI", "ChatGPT", "GPT", "Claude", "Gemini", "Anthropic",
      "LLM", "언어 모델", "멀티모달", "파운데이션 모델",
      "디지털 전환", "DX 전략", "자동화 솔루션", "데이터 분석",
    ],
  },
];

function getDomains(text: string): string[] {
  const t = text.toLowerCase();
  return DOMAINS.filter((d) =>
    d.keywords.some((kw) => t.includes(kw.toLowerCase()))
  ).map((d) => d.label);
}

// EZPMP 카테고리 → 사업영역 연관도
const CATEGORY_RELEVANCE: Record<string, { level: "high" | "mid" | "low"; label: string }> = {
  AI:         { level: "high", label: "AXDX · AI 관광 · MICE Tech" },
  MICE:       { level: "high", label: "MICE Tech · ATT" },
  TOURISM:    { level: "high", label: "스마트립 · 글로컬 · ATT" },
  STARTUP:    { level: "mid",  label: "간접 연관 가능" },
  POLICY:     { level: "mid",  label: "간접 연관 가능" },
  OPERATIONS: { level: "low",  label: "사업영역 외 가능성" },
  INDUSTRY:   { level: "low",  label: "사업영역 외 가능성" },
};

// ── 도메인 툴팁 (viewport 경계 자동 감지) ──────────────────────────
function DomainTooltip({ articles, color, label }: { articles: NewsItem[]; color: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 16) setFlipUp(true);
  }, []);

  const preview = articles.slice(0, 8);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        right: 0,
        ...(flipUp ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
        zIndex: 50,
        width: 300,
        maxHeight: 320,
        overflowY: "auto",
        background: "var(--surface-container-lowest)",
        border: "1px solid var(--surface-container-high)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(26,28,29,0.14)",
        pointerEvents: "none",
      }}
    >
      <p style={{
        margin: 0, padding: "8px 12px 6px",
        fontSize: "0.65rem", fontWeight: 700,
        letterSpacing: "0.05em", textTransform: "uppercase",
        color, borderBottom: "1px solid var(--surface-container-high)",
        position: "sticky", top: 0,
        background: "var(--surface-container-lowest)",
      }}>
        {label} · {articles.length}건
      </p>
      {preview.map((a) => (
        <div key={a.id} style={{
          padding: "6px 12px",
          borderBottom: "1px solid var(--surface-container-high)",
        }}>
          <p style={{
            margin: 0, fontSize: "0.73rem", color: "var(--on-surface)",
            overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", lineHeight: 1.4,
          }}>
            {a.title}
          </p>
          <p style={{ margin: 0, fontSize: "0.62rem", color: "var(--on-surface-variant)" }}>
            {a.category}
          </p>
        </div>
      ))}
      {articles.length > 8 && (
        <p style={{
          margin: 0, padding: "6px 12px",
          fontSize: "0.65rem", color: "var(--on-surface-variant)",
        }}>
          외 {articles.length - 8}건 더 있음
        </p>
      )}
    </div>
  );
}

// ── 뉴스 정합성 탭 ─────────────────────────────────────────────────
function NewsTab({ news, sources }: { news: NewsItem[]; sources: RssSource[] }) {
  const [issueFilter, setIssueFilter] = useState<"all" | "missing" | "dup" | "mismatch">("all");
  const [showUnclassified, setShowUnclassified] = useState(false);
  const [togglingSource, setTogglingSource] = useState<string | null>(null);
  const [sourceList, setSourceList] = useState<RssSource[]>(sources);

  const stats = useMemo(() => {
    const published = news.filter((n) => n.is_published);
    const pending = news.filter((n) => !n.is_published);
    // 이미지 없음은 제외 — ArticleImg 컴포넌트가 로고로 자동 대체하므로 이슈 아님
    const missingField = news.filter(
      (n) => !n.category || !n.summary_short
    );
    const urlMap = new Map<string, number>();
    news.forEach((n) => urlMap.set(n.original_url, (urlMap.get(n.original_url) ?? 0) + 1));
    const duplicates = news.filter((n) => (urlMap.get(n.original_url) ?? 0) > 1);
    const mismatch = news.filter(
      (n) =>
        (n.is_published && (n.quality_score ?? 10) < 4) ||
        (!n.is_published && (n.quality_score ?? 0) >= 8)
    );
    return { total: news.length, published: published.length, pending: pending.length, missingField: missingField.length, duplicates: duplicates.length, mismatch: mismatch.length };
  }, [news]);

  // 사업영역 커버리지
  const domainCoverage = useMemo(() => {
    const published = news.filter((n) => n.is_published);
    const counts: Record<string, number> = {};
    const articles: Record<string, NewsItem[]> = {};
    const unclassifiedItems: NewsItem[] = [];
    for (const n of published) {
      const text = `${n.title} ${n.summary_short ?? ""} ${n.category ?? ""}`;
      const domains = getDomains(text);
      if (domains.length === 0) unclassifiedItems.push(n);
      domains.forEach((d) => {
        counts[d] = (counts[d] ?? 0) + 1;
        if (!articles[d]) articles[d] = [];
        articles[d].push(n);
      });
    }
    return { counts, articles, unclassifiedItems, total: published.length };
  }, [news]);

  const [hoveredDomain, setHoveredDomain] = useState<string | null>(null);

  // 이슈 목록
  const issueItems = useMemo(() => {
    const urlMap = new Map<string, string[]>();
    news.forEach((n) => {
      const arr = urlMap.get(n.original_url) ?? [];
      arr.push(n.id);
      urlMap.set(n.original_url, arr);
    });

    return news
      .map((n) => {
        const issues: string[] = [];
        // 이미지 없음은 제외 — ArticleImg 가 로고로 자동 대체
        if (!n.category) issues.push("카테고리 없음");
        if (!n.summary_short) issues.push("요약 없음");
        if ((urlMap.get(n.original_url)?.length ?? 0) > 1) issues.push("URL 중복");
        if (n.is_published && (n.quality_score ?? 10) < 4) issues.push("발행됐으나 저품질");
        if (!n.is_published && (n.quality_score ?? 0) >= 8) issues.push("고품질이나 미발행");

        const text = `${n.title} ${n.summary_short ?? ""} ${n.category ?? ""}`;
        const domains = getDomains(text);

        return { ...n, issues, domains };
      })
      .filter((n) => {
        if (issueFilter === "missing") return n.issues.some((i) => i.includes("없음"));
        if (issueFilter === "dup") return n.issues.includes("URL 중복");
        if (issueFilter === "mismatch") return n.issues.some((i) => i.includes("품질") || i.includes("미발행"));
        return n.issues.length > 0;
      });
  }, [news, issueFilter]);

  const statCards = [
    { label: "전체 기사", value: stats.total, color: "var(--on-surface)" },
    { label: "발행됨", value: stats.published, color: "#2563eb" },
    { label: "대기 중", value: stats.pending, color: "#d97706" },
    { label: "빠진 필드", value: stats.missingField, color: "#ef4444" },
    { label: "URL 중복", value: stats.duplicates, color: "#dc2626" },
    { label: "점수 불일치", value: stats.mismatch, color: "#9333ea" },
  ];

  return (
    <div>
      {/* 통계 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 28 }}>
        {statCards.map(({ label, value, color }) => (
          <div key={label} style={{ padding: "14px 16px", borderRadius: 10,
            background: "var(--surface-container-lowest)",
            border: "1px solid var(--surface-container-high)" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.65rem", fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--on-surface-variant)" }}>{label}</p>
            <p style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
        {/* 사업영역 커버리지 */}
        <div style={{ padding: 20, borderRadius: 12,
          background: "var(--surface-container-lowest)",
          border: "1px solid var(--surface-container-high)" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: "0.88rem" }}>
            📊 사업영역 커버리지
            <span style={{ marginLeft: 8, fontSize: "0.72rem", fontWeight: 400,
              color: "var(--on-surface-variant)" }}>
              발행 기사 {domainCoverage.total}건 기준
            </span>
          </p>
          {DOMAINS.map((d) => {
            const cnt = domainCoverage.counts[d.label] ?? 0;
            const pct = domainCoverage.total ? Math.round((cnt / domainCoverage.total) * 100) : 0;
            const domainArticles = domainCoverage.articles[d.label] ?? [];
            const isHovered = hoveredDomain === d.label;
            return (
              <div key={d.label} style={{ marginBottom: 10, position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  fontSize: "0.75rem", marginBottom: 3 }}>
                  <span style={{ color: d.color, fontWeight: 600 }}>{d.label}</span>
                  <span
                    onMouseEnter={() => cnt > 0 && setHoveredDomain(d.label)}
                    onMouseLeave={() => setHoveredDomain(null)}
                    style={{
                      color: "var(--on-surface-variant)",
                      cursor: cnt > 0 ? "pointer" : "default",
                      textDecoration: isHovered ? "underline" : "none",
                      position: "relative",
                    }}
                  >
                    {cnt}건 ({pct}%)
                    {isHovered && domainArticles.length > 0 && (
                      <DomainTooltip articles={domainArticles} color={d.color} label={d.label} />
                    )}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3,
                  background: "var(--surface-container-high)" }}>
                  <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3,
                    background: d.color, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })}
          {domainCoverage.unclassifiedItems.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setShowUnclassified((v) => !v)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  width: "100%", padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                  border: "1px dashed #ef444460",
                  background: showUnclassified ? "#ef444410" : "transparent",
                }}
              >
                <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
                  ⚠️ 미분류 (사업영역 미매칭) {showUnclassified ? "▲" : "▼"}
                </span>
                <span style={{ fontSize: "0.72rem", color: "#ef4444", fontWeight: 700 }}>
                  {domainCoverage.unclassifiedItems.length}건
                  ({Math.round((domainCoverage.unclassifiedItems.length / (domainCoverage.total || 1)) * 100)}%)
                </span>
              </button>
              {showUnclassified && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4,
                  maxHeight: 280, overflowY: "auto" }}>
                  {domainCoverage.unclassifiedItems.map((n) => (
                    <a
                      key={n.id}
                      href={n.original_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      <div style={{
                        padding: "7px 10px", borderRadius: 6,
                        background: "var(--surface-container)",
                        border: "1px solid var(--surface-container-high)",
                        display: "flex", justifyContent: "space-between",
                        alignItems: "flex-start", gap: 8,
                      }}>
                        <p style={{
                          margin: 0, fontSize: "0.75rem", color: "var(--on-surface)",
                          overflow: "hidden", textOverflow: "ellipsis",
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          lineHeight: 1.4,
                        }}>
                          {n.title}
                        </p>
                        <div style={{ display: "flex", flexDirection: "column",
                          alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                          <span style={{
                            fontSize: "0.62rem", padding: "1px 6px", borderRadius: 10,
                            background: "#64748b18", color: "#64748b", fontWeight: 600,
                          }}>
                            {n.category ?? "미분류"}
                          </span>
                          {n.quality_score != null && (
                            <span style={{ fontSize: "0.62rem", color: "var(--on-surface-variant)" }}>
                              품질 {n.quality_score}점
                            </span>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 이슈 요약 */}
        <div style={{ padding: 20, borderRadius: 12,
          background: "var(--surface-container-lowest)",
          border: "1px solid var(--surface-container-high)" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: "0.88rem" }}>
            🔍 큐레이션 정확도 체크
          </p>
          {[
            { key: "all" as const, label: "전체 이슈", count: issueItems.length, color: "#64748b" },
            { key: "missing" as const, label: "빠진 필드", count: news.filter(n => !n.category || !n.summary_short).length, color: "#ef4444" },
            { key: "dup" as const, label: "URL 중복", count: stats.duplicates, color: "#dc2626" },
            { key: "mismatch" as const, label: "점수 불일치", count: stats.mismatch, color: "#9333ea" },
          ].map(({ key, label, count, color }) => (
            <button
              key={key}
              onClick={() => setIssueFilter(issueFilter === key ? "all" : key)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                width: "100%", padding: "8px 12px", marginBottom: 6, borderRadius: 8,
                border: `1px solid ${issueFilter === key ? color : "var(--surface-container-high)"}`,
                background: issueFilter === key ? color + "12" : "transparent",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ fontSize: "0.78rem", color: issueFilter === key ? color : "var(--on-surface-variant)" }}>
                {label}
              </span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color }}>
                {count}건
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 이슈 기사 목록 */}
      {issueItems.length > 0 && (
        <div>
          <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: "0.88rem" }}>
            이슈 기사 목록 ({issueItems.length}건)
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {issueItems.slice(0, 50).map((n) => (
              <div key={n.id} style={{
                display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px",
                borderRadius: 8, background: "var(--surface-container-lowest)",
                border: "1px solid var(--surface-container-high)",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: "0.82rem",
                    color: "var(--on-surface)", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.title}
                  </p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {n.issues.map((issue) => (
                      <span key={issue} style={{
                        padding: "1px 7px", borderRadius: 20, fontSize: "0.62rem",
                        fontWeight: 600, background: "#ef444418", color: "#ef4444",
                      }}>
                        {issue}
                      </span>
                    ))}
                    {n.domains.map((d) => {
                      const dom = DOMAINS.find((x) => x.label === d);
                      return (
                        <span key={d} style={{
                          padding: "1px 7px", borderRadius: 20, fontSize: "0.62rem",
                          fontWeight: 600, background: (dom?.color ?? "#64748b") + "18",
                          color: dom?.color ?? "#64748b",
                        }}>
                          {d}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end",
                  gap: 4, flexShrink: 0 }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 20, fontSize: "0.65rem", fontWeight: 700,
                    background: n.is_published ? "#2563eb18" : "#64748b18",
                    color: n.is_published ? "#2563eb" : "#64748b",
                  }}>
                    {n.is_published ? "발행됨" : "대기"}
                  </span>
                  {n.quality_score != null && (
                    <span style={{ fontSize: "0.65rem", color: "var(--on-surface-variant)" }}>
                      품질 {n.quality_score}점
                    </span>
                  )}
                </div>
              </div>
            ))}
            {issueItems.length > 50 && (
              <p style={{ textAlign: "center", fontSize: "0.75rem",
                color: "var(--on-surface-variant)", margin: "8px 0 0" }}>
                외 {issueItems.length - 50}건 더 있음
              </p>
            )}
          </div>
        </div>
      )}

      {/* RSS 소스 분석 */}
      <RssSourcesPanel sources={sourceList} onToggle={async (id, current) => {
        setTogglingSource(id);
        try {
          const res = await fetch("/api/admin/rss", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, is_active: !current }),
          });
          if (res.ok) {
            setSourceList((prev) =>
              prev.map((s) => s.id === id ? { ...s, is_active: !current } : s)
            );
          }
        } finally {
          setTogglingSource(null);
        }
      }} toggling={togglingSource} />
    </div>
  );
}

// ── RSS 소스 분석 패널 ────────────────────────────────────────────
function RssSourcesPanel({
  sources,
  onToggle,
  toggling,
}: {
  sources: RssSource[];
  onToggle: (id: string, current: boolean) => void;
  toggling: string | null;
}) {
  const [open, setOpen] = useState(true);

  const activeCount = sources.filter((s) => s.is_active).length;
  const byCategory = useMemo(() => {
    const map: Record<string, RssSource[]> = {};
    for (const s of sources) {
      const key = s.default_category ?? "미지정";
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, [sources]);

  const SOURCE_TYPE_LABEL: Record<string, string> = {
    rss: "RSS", url: "URL", api: "API", gmail: "Gmail",
  };

  const RELEVANCE_COLOR = { high: "#10b981", mid: "#f59e0b", low: "#ef4444" };

  return (
    <div style={{ marginTop: 32 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, background: "none",
          border: "none", cursor: "pointer", padding: 0, marginBottom: 12,
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, fontSize: "0.88rem", color: "var(--on-surface)" }}>
          📡 RSS 소스 분석
        </p>
        <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
          활성 {activeCount} / 전체 {sources.length}개 {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 카테고리별 연관도 요약 */}
          <div style={{
            display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4,
          }}>
            {Object.entries(CATEGORY_RELEVANCE).map(([cat, info]) => {
              const count = (byCategory[cat] ?? []).filter((s) => s.is_active).length;
              if (!count) return null;
              return (
                <div key={cat} style={{
                  padding: "4px 10px", borderRadius: 20, fontSize: "0.68rem",
                  fontWeight: 600,
                  background: RELEVANCE_COLOR[info.level] + "18",
                  color: RELEVANCE_COLOR[info.level],
                  border: `1px solid ${RELEVANCE_COLOR[info.level]}40`,
                }}>
                  {cat} {count}개 — {info.label}
                </div>
              );
            })}
            {(byCategory["미지정"] ?? []).filter((s) => s.is_active).length > 0 && (
              <div style={{
                padding: "4px 10px", borderRadius: 20, fontSize: "0.68rem",
                fontWeight: 600, background: "#94a3b818", color: "#94a3b8",
                border: "1px solid #94a3b840",
              }}>
                카테고리 미지정 {(byCategory["미지정"] ?? []).filter((s) => s.is_active).length}개
              </div>
            )}
          </div>

          {/* 소스 테이블 */}
          <div style={{ borderRadius: 10, overflow: "hidden",
            border: "1px solid var(--surface-container-high)" }}>
            {/* 헤더 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 60px 50px 70px 60px",
              padding: "7px 14px", gap: 8,
              background: "var(--surface-container)",
              fontSize: "0.65rem", fontWeight: 700,
              letterSpacing: "0.04em", textTransform: "uppercase",
              color: "var(--on-surface-variant)",
            }}>
              <span>소스명</span>
              <span>카테고리</span>
              <span>연관도</span>
              <span>유형</span>
              <span>가중치</span>
              <span>활성</span>
            </div>
            <div style={{ maxHeight: 440, overflowY: "auto" }}>
              {sources.map((s, idx) => {
                const rel = s.default_category ? CATEGORY_RELEVANCE[s.default_category] : null;
                return (
                  <div key={s.id} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 60px 50px 70px 60px",
                    padding: "8px 14px", gap: 8, alignItems: "center",
                    borderTop: idx > 0 ? "1px solid var(--surface-container-high)" : "none",
                    background: s.is_active ? "var(--surface-container-lowest)" : "var(--surface-container)",
                    opacity: s.is_active ? 1 : 0.55,
                  }}>
                    <span style={{
                      fontSize: "0.78rem", color: "var(--on-surface)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={s.url}>
                      {s.source_name}
                    </span>
                    <span style={{
                      fontSize: "0.72rem", fontWeight: 600,
                      color: rel ? RELEVANCE_COLOR[rel.level] : "#94a3b8",
                    }}>
                      {s.default_category ?? "—"}
                    </span>
                    <span style={{ fontSize: "0.68rem", color: rel ? RELEVANCE_COLOR[rel.level] : "#94a3b8" }}>
                      {rel ? (rel.level === "high" ? "✅ 높음" : rel.level === "mid" ? "⚠️ 보통" : "❌ 낮음") : "—"}
                    </span>
                    <span style={{ fontSize: "0.68rem", color: "var(--on-surface-variant)" }}>
                      {SOURCE_TYPE_LABEL[s.source_type ?? ""] ?? s.source_type ?? "—"}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
                      x{s.weight}
                    </span>
                    <button
                      onClick={() => onToggle(s.id, s.is_active)}
                      disabled={toggling === s.id}
                      style={{
                        padding: "3px 8px", borderRadius: 20, fontSize: "0.65rem",
                        fontWeight: 700, cursor: toggling === s.id ? "wait" : "pointer",
                        border: "none", opacity: toggling === s.id ? 0.5 : 1,
                        background: s.is_active ? "#10b98118" : "#64748b18",
                        color: s.is_active ? "#10b981" : "#64748b",
                        transition: "all 0.15s",
                      }}
                    >
                      {s.is_active ? "활성" : "비활성"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 수동 관리 패널 ────────────────────────────────────────────────
type DedupPreview = { noise: number; dup: number; foreign: number; total_delete: number; dup_groups: number } | null;

type ImportPreview = {
  new_count: number; merge_count: number; skip_count: number;
  preview_new:   { name: string; date: string; venue: string }[];
  preview_merge: { name: string; date: string; fields: string[] }[];
} | null;

function ManualOpsPanel() {
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [dedupPreview, setDedupPreview] = useState<DedupPreview>(null);
  const [dedupStatus, setDedupStatus] = useState<"idle" | "loading" | "ready" | "running" | "done" | "error">("idle");
  const [dedupMsg, setDedupMsg]   = useState("");
  const [open, setOpen] = useState(false);

  // AKEI 가져오기
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]   = useState<unknown[] | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "parsing" | "previewing" | "ready" | "running" | "done" | "error">("idle");
  const [importMsg,    setImportMsg]    = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus("parsing");
    setImportPreview(null);
    setImportMsg("");
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      setImportRows(rows);
      // 자동으로 미리보기 요청
      const res  = await fetch("/api/admin/import-exhibitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dry_run: true }),
      });
      const data = await res.json();
      setImportPreview(data);
      setImportStatus("ready");
    } catch (err) {
      setImportStatus("error");
      setImportMsg(err instanceof Error ? err.message : "파일 파싱 오류");
    }
  }

  async function runImport() {
    if (!importRows) return;
    setImportStatus("running");
    try {
      const res  = await fetch("/api/admin/import-exhibitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows, dry_run: false }),
      });
      const data = await res.json();
      if (data.ok) {
        setImportMsg(`신규 ${data.inserted}건 추가 · ${data.updated}건 보강 · ${data.skipped}건 스킵`);
        setImportStatus("done");
      } else {
        setImportMsg(data.error ?? "오류 발생");
        setImportStatus("error");
      }
    } catch {
      setImportStatus("error");
      setImportMsg("실행 실패");
    }
  }

  function resetImport() {
    setImportRows(null); setImportPreview(null);
    setImportStatus("idle"); setImportMsg("");
    if (importFileRef.current) importFileRef.current.value = "";
  }

  async function handleScrape() {
    setScrapeStatus("running");
    try {
      const res = await fetch("/api/admin/scrape-events", { method: "POST" });
      setScrapeStatus(res.ok ? "done" : "error");
    } catch {
      setScrapeStatus("error");
    }
  }

  async function loadDedupPreview() {
    setDedupStatus("loading");
    setDedupPreview(null);
    try {
      const res = await fetch("/api/admin/dedup-events");
      const data = await res.json();
      setDedupPreview(data);
      setDedupStatus("ready");
    } catch {
      setDedupStatus("error");
      setDedupMsg("미리보기 로드 실패");
    }
  }

  async function runDedup() {
    setDedupStatus("running");
    try {
      const res = await fetch("/api/admin/dedup-events", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setDedupMsg(`삭제 ${data.total_delete}건, 비공개 ${data.foreign}건 처리 완료`);
        setDedupStatus("done");
      } else {
        setDedupMsg(data.error ?? "오류 발생");
        setDedupStatus("error");
      }
    } catch {
      setDedupStatus("error");
      setDedupMsg("실행 실패");
    }
  }

  const scrapeColor: Record<string, string> = {
    idle: "#64748b", running: "#f59e0b", done: "#10b981", error: "#ef4444",
  };
  const scrapeLabel: Record<string, string> = {
    idle: "스크래핑 실행", running: "실행 중...", done: "완료 ✓", error: "오류 — 재시도",
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, background: "none",
          border: "none", cursor: "pointer", padding: "0 0 12px", width: "100%",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--on-surface)" }}>
          🛠 수동 관리
        </span>
        <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16,
          padding: 20, borderRadius: 12,
          border: "1px solid var(--surface-container-high)",
          background: "var(--surface-container-lowest)",
          marginBottom: 4,
        }}>
          {/* ── 스크래핑 ── */}
          <div>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.82rem" }}>
              📡 행사 데이터 수집
            </p>
            <p style={{ margin: "0 0 12px", fontSize: "0.73rem", color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
              쇼알라 + 한국전시주최자협회에서 최신 행사를 수집합니다.
              수집은 백그라운드에서 진행되며 약 1~2분 소요됩니다.
            </p>
            <button
              onClick={handleScrape}
              disabled={scrapeStatus === "running"}
              style={{
                padding: "7px 18px", borderRadius: 8, fontSize: "0.78rem",
                fontWeight: 700, cursor: scrapeStatus === "running" ? "wait" : "pointer",
                border: `1px solid ${scrapeColor[scrapeStatus]}40`,
                background: scrapeColor[scrapeStatus] + "18",
                color: scrapeColor[scrapeStatus],
                transition: "all 0.2s",
              }}
            >
              {scrapeLabel[scrapeStatus]}
            </button>
            {scrapeStatus === "done" && (
              <p style={{ margin: "8px 0 0", fontSize: "0.72rem", color: "#10b981" }}>
                백그라운드에서 실행 중입니다. 1~2분 후 새로고침하면 결과를 확인할 수 있습니다.
              </p>
            )}
          </div>

          {/* ── 중복/불량 정리 ── */}
          <div>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.82rem" }}>
              🧹 중복 / 불량 데이터 정리
            </p>
            <p style={{ margin: "0 0 12px", fontSize: "0.73rem", color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
              노이즈 행사명 삭제(총회·웨딩·설명회 등 포함), 완전 중복 제거(정보량 낮은 쪽)를 수행합니다.
            </p>

            {/* 미리보기 */}
            {dedupPreview && dedupStatus === "ready" && (
              <div style={{
                padding: "10px 12px", borderRadius: 8, marginBottom: 10,
                background: "var(--surface-container)",
                border: "1px solid var(--surface-container-high)",
                fontSize: "0.73rem", color: "var(--on-surface-variant)",
              }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--on-surface)", fontSize: "0.75rem" }}>
                  미리보기 결과
                </p>
                <span style={{ marginRight: 14 }}>노이즈 삭제 <b style={{ color: "#ef4444" }}>{dedupPreview.noise}건</b></span>
                <span style={{ marginRight: 14 }}>중복 삭제 <b style={{ color: "#ef4444" }}>{dedupPreview.dup}건</b> ({dedupPreview.dup_groups}그룹)</span>
                <span>해외 비공개 <b style={{ color: "#d97706" }}>{dedupPreview.foreign}건</b></span>
              </div>
            )}

            {dedupStatus === "done" && (
              <p style={{ margin: "0 0 10px", fontSize: "0.73rem", color: "#10b981", fontWeight: 600 }}>
                ✅ {dedupMsg}
              </p>
            )}
            {dedupStatus === "error" && (
              <p style={{ margin: "0 0 10px", fontSize: "0.73rem", color: "#ef4444" }}>
                ⚠️ {dedupMsg}
              </p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={loadDedupPreview}
                disabled={dedupStatus === "loading" || dedupStatus === "running"}
                style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: "0.78rem",
                  fontWeight: 600, cursor: "pointer",
                  border: "1px solid var(--surface-container-high)",
                  background: "transparent", color: "var(--on-surface-variant)",
                  transition: "all 0.2s",
                }}
              >
                {dedupStatus === "loading" ? "분석 중..." : "미리보기"}
              </button>
              <button
                onClick={runDedup}
                disabled={dedupStatus === "running" || dedupStatus === "loading"}
                style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: "0.78rem",
                  fontWeight: 700, cursor: dedupStatus === "running" ? "wait" : "pointer",
                  border: "1px solid #ef444440",
                  background: "#ef444418", color: "#ef4444",
                  transition: "all 0.2s",
                  opacity: dedupStatus === "running" ? 0.6 : 1,
                }}
              >
                {dedupStatus === "running" ? "실행 중..." : "정리 실행"}
              </button>
            </div>
          </div>

          {/* ── AKEI 엑셀 가져오기 ── */}
          <div>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.82rem" }}>
              📥 AKEI 엑셀 가져오기
            </p>
            <p style={{ margin: "0 0 12px", fontSize: "0.73rem", color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
              한국전시산업진흥회 크롤러 엑셀을 업로드하면 중복 분석 후 신규 추가·빈 필드 보강을 수행합니다.
            </p>

            {importStatus === "idle" && (
              <label style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 8, fontSize: "0.78rem",
                fontWeight: 600, cursor: "pointer",
                border: "1px solid var(--surface-container-high)",
                background: "transparent", color: "var(--on-surface-variant)",
              }}>
                📂 엑셀 선택
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
              </label>
            )}

            {importStatus === "parsing" && (
              <p style={{ fontSize: "0.73rem", color: "#f59e0b", margin: 0 }}>⏳ 파일 분석 중...</p>
            )}

            {importStatus === "ready" && importPreview && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{
                  padding: "10px 12px", borderRadius: 8,
                  background: "var(--surface-container)",
                  border: "1px solid var(--surface-container-high)",
                  fontSize: "0.73rem",
                }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.75rem", color: "var(--on-surface)" }}>미리보기</p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>✅ 신규 <b style={{ color: "#10b981" }}>{importPreview.new_count}건</b></span>
                    <span>🔄 보강 <b style={{ color: "#f59e0b" }}>{importPreview.merge_count}건</b></span>
                    <span>⏭ 스킵 <b style={{ color: "#94a3b8" }}>{importPreview.skip_count}건</b></span>
                  </div>
                  {importPreview.preview_new.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <p style={{ margin: "0 0 3px", fontSize: "0.65rem", fontWeight: 600, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.04em" }}>신규 샘플</p>
                      {importPreview.preview_new.map((r, i) => (
                        <p key={i} style={{ margin: "1px 0", fontSize: "0.68rem", color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.name} · {r.date}
                        </p>
                      ))}
                    </div>
                  )}
                  {importPreview.preview_merge.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <p style={{ margin: "0 0 3px", fontSize: "0.65rem", fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.04em" }}>보강 샘플</p>
                      {importPreview.preview_merge.map((r, i) => (
                        <p key={i} style={{ margin: "1px 0", fontSize: "0.68rem", color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.name} · +{r.fields.join(", ")}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={resetImport} style={{
                    padding: "7px 12px", borderRadius: 8, fontSize: "0.75rem",
                    fontWeight: 600, cursor: "pointer",
                    border: "1px solid var(--surface-container-high)",
                    background: "transparent", color: "var(--on-surface-variant)",
                  }}>취소</button>
                  <button onClick={runImport} style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: "0.78rem",
                    fontWeight: 700, cursor: "pointer",
                    border: "1px solid #10b98140",
                    background: "#10b98118", color: "#10b981",
                  }}>가져오기 실행</button>
                </div>
              </div>
            )}

            {importStatus === "running" && (
              <p style={{ fontSize: "0.73rem", color: "#f59e0b", margin: 0 }}>⏳ 가져오는 중...</p>
            )}

            {importStatus === "done" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ margin: 0, fontSize: "0.73rem", color: "#10b981", fontWeight: 600 }}>✅ {importMsg}</p>
                <button onClick={resetImport} style={{
                  alignSelf: "flex-start", padding: "5px 12px", borderRadius: 8,
                  fontSize: "0.73rem", cursor: "pointer",
                  border: "1px solid var(--surface-container-high)",
                  background: "transparent", color: "var(--on-surface-variant)",
                }}>다시 가져오기</button>
              </div>
            )}

            {importStatus === "error" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ margin: 0, fontSize: "0.73rem", color: "#ef4444" }}>⚠️ {importMsg}</p>
                <button onClick={resetImport} style={{
                  alignSelf: "flex-start", padding: "5px 12px", borderRadius: 8,
                  fontSize: "0.73rem", cursor: "pointer",
                  border: "1px solid var(--surface-container-high)",
                  background: "transparent", color: "var(--on-surface-variant)",
                }}>다시 시도</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 행사 관리 탭 ─────────────────────────────────────────────────
function EventsTab({ initialEvents }: { initialEvents: EventRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "hidden">("all");
  const [venueFilter, setVenueFilter] = useState("전체");
  const [toggling, setToggling] = useState<string | null>(null);
  // 키워드 필터 관리
  type KeywordFilter = { id: string; keyword: string; memo: string | null };
  const [filters, setFilters] = useState<KeywordFilter[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  // 비공개 시 키워드 추가 팝업
  const [keywordPrompt, setKeywordPrompt] = useState<{ id: string; eventName: string } | null>(null);
  const [promptKeyword, setPromptKeyword] = useState("");
  // 인라인 편집
  type EditField = "event_name" | "organizer" | "start_date" | "end_date" | "venue";
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingCell, setSavingCell] = useState<string | null>(null); // "id-field"

  const venues = useMemo(() => {
    const set = new Set(events.map((e) => e.venue));
    return ["전체", ...Array.from(set).sort()];
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (statusFilter === "published" && !e.is_published) return false;
      if (statusFilter === "hidden" && e.is_published) return false;
      if (venueFilter !== "전체" && e.venue !== venueFilter) return false;
      if (search && !e.event_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [events, statusFilter, venueFilter, search]);

  const stats = useMemo(() => ({
    total: events.length,
    published: events.filter((e) => e.is_published).length,
    hidden: events.filter((e) => !e.is_published).length,
    noOrg: events.filter((e) => !e.organizer).length,
    shortName: events.filter((e) => e.event_name.length <= 4).length,
  }), [events]);

  async function togglePublish(id: string, current: boolean, eventName?: string) {
    setToggling(id);
    try {
      const res = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_published: !current }),
      });
      if (res.ok) {
        setEvents((prev) =>
          prev.map((e) => e.id === id ? { ...e, is_published: !current } : e)
        );
        // 공개→비공개 전환 시 키워드 추가 팝업
        if (current && eventName) {
          setKeywordPrompt({ id, eventName });
          setPromptKeyword("");
        }
      }
    } finally {
      setToggling(null);
    }
  }

  async function loadFilters() {
    const res = await fetch("/api/admin/event-filters");
    const json = await res.json();
    setFilters(json.data ?? []);
  }

  async function addKeyword() {
    if (!newKeyword.trim()) return;
    setAddingKeyword(true);
    try {
      const res = await fetch("/api/admin/event-filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: newKeyword.trim(), memo: newMemo.trim() || undefined }),
      });
      if (res.ok) {
        const json = await res.json();
        setFilters((prev) => [json.data, ...prev]);
        setNewKeyword(""); setNewMemo("");
      }
    } finally { setAddingKeyword(false); }
  }

  async function deleteKeyword(id: string) {
    await fetch("/api/admin/event-filters", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setFilters((prev) => prev.filter((f) => f.id !== id));
  }

  async function addKeywordFromPrompt() {
    if (!promptKeyword.trim()) { setKeywordPrompt(null); return; }
    await fetch("/api/admin/event-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: promptKeyword.trim(), memo: "비공개 처리 시 추가" }),
    });
    setKeywordPrompt(null);
    setPromptKeyword("");
  }

  async function deleteAsDuplicate() {
    if (!keywordPrompt) return;
    await fetch("/api/admin/dedup-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [keywordPrompt.id] }),
    });
    // 로컬 상태에서 제거
    setEvents((prev) => prev.filter((e) => e.id !== keywordPrompt.id));
    setKeywordPrompt(null);
  }

  function startEdit(id: string, field: EditField, currentValue: string) {
    setEditingCell({ id, field });
    setEditValue(currentValue ?? "");
  }

  async function saveEdit() {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const cellKey = `${id}-${field}`;
    setSavingCell(cellKey);
    try {
      const res = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, [field]: editValue || null }),
      });
      if (res.ok) {
        setEvents((prev) =>
          prev.map((e) => e.id === id ? { ...e, [field]: editValue || null } : e)
        );
      }
    } finally {
      setSavingCell(null);
      setEditingCell(null);
    }
  }

  function cancelEdit() {
    setEditingCell(null);
    setEditValue("");
  }

  function EditableCell({ id, field, value, type = "text" }: {
    id: string; field: EditField; value: string | null; type?: "text" | "date";
  }) {
    const isEditing = editingCell?.id === id && editingCell?.field === field;
    const isSaving = savingCell === `${id}-${field}`;
    if (isEditing) {
      return (
        <input
          autoFocus
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
          onBlur={saveEdit}
          style={{
            width: "100%", fontSize: "0.78rem", padding: "2px 6px", borderRadius: 4,
            border: "1.5px solid var(--primary)", background: "var(--surface-container-lowest)",
            color: "var(--on-surface)", outline: "none", boxSizing: "border-box",
            opacity: isSaving ? 0.5 : 1,
          }}
        />
      );
    }
    return (
      <span
        onClick={() => startEdit(id, field, value ?? "")}
        title="클릭해서 편집"
        style={{
          display: "block", fontSize: "0.78rem", cursor: "text",
          color: value ? "var(--on-surface)" : "#ef4444",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          padding: "2px 4px", borderRadius: 4,
          border: "1px dashed transparent",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--surface-container-high)")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
      >
        {value || "—"}
      </span>
    );
  }

  function hasIssue(e: EventRow) {
    return !e.organizer || e.event_name.length <= 4 || !e.category;
  }

  const fmtDate = (s: string) => {
    // new Date() is timezone-sensitive → parse string directly to avoid SSR/client mismatch
    const parts = s.split("-");
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  };

  return (
    <div>
      {/* 수동 관리 패널 */}
      <ManualOpsPanel />

      {/* 비공개 시 키워드 추가 팝업 */}
      {keywordPrompt && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ background: "var(--surface-container-lowest)", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 15 }}>차단 키워드 추가</p>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--on-surface-variant)" }}>
              <b>{keywordPrompt.eventName}</b>을 비공개 처리했어요.<br/>
              앞으로 비슷한 행사도 자동 비공개하려면 키워드를 입력하세요.
            </p>
            <input
              autoFocus
              value={promptKeyword}
              onChange={(e) => setPromptKeyword(e.target.value)}
              placeholder="예: 총회, 웨딩, 설명회..."
              onKeyDown={(e) => e.key === "Enter" && addKeywordFromPrompt()}
              style={{
                width: "100%", height: 34, padding: "0 10px", borderRadius: 6, fontSize: 13,
                border: "1px solid var(--surface-container-highest)",
                background: "var(--surface-container-low)",
                color: "var(--on-surface)", outline: "none", boxSizing: "border-box", marginBottom: 14,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={() => setKeywordPrompt(null)} style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "var(--surface-container-high)", color: "var(--on-surface)", cursor: "pointer", fontSize: 13 }}>
                그냥 비공개만
              </button>
              <button onClick={deleteAsDuplicate} style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "#fee2e2", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                🗑 중복 삭제
              </button>
              <button onClick={addKeywordFromPrompt} style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                키워드 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 키워드 필터 관리 */}
      <div style={{ marginBottom: 16, border: "1px solid var(--surface-container-high)", borderRadius: 10, overflow: "hidden" }}>
        <button
          onClick={() => { setFiltersOpen(o => !o); if (!filtersOpen && filters.length === 0) loadFilters(); }}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--surface-container)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--on-surface)" }}
        >
          <span>🚫 자동 비공개 키워드 관리</span>
          <span style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>{filtersOpen ? "▲" : "▼"}</span>
        </button>
        {filtersOpen && (
          <div style={{ padding: "12px 16px" }}>
            <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--on-surface-variant)" }}>
              행사명에 아래 키워드가 포함되면 수집 시 자동으로 비공개 처리됩니다.
            </p>
            {/* 키워드 추가 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="키워드" onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                style={{ flex: 1, height: 30, padding: "0 8px", borderRadius: 6, fontSize: 12, border: "1px solid var(--surface-container-highest)", background: "var(--surface-container-low)", color: "var(--on-surface)", outline: "none" }} />
              <input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder="메모(선택)"
                style={{ flex: 1, height: 30, padding: "0 8px", borderRadius: 6, fontSize: 12, border: "1px solid var(--surface-container-highest)", background: "var(--surface-container-low)", color: "var(--on-surface)", outline: "none" }} />
              <button onClick={addKeyword} disabled={addingKeyword || !newKeyword.trim()} style={{ height: 30, padding: "0 12px", borderRadius: 6, border: "none", background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>추가</button>
            </div>
            {/* 키워드 목록 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {filters.length === 0 && <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>키워드 없음</span>}
              {filters.map((f) => (
                <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: "var(--surface-container-high)", fontSize: 12, color: "var(--on-surface)" }}>
                  {f.keyword}
                  {f.memo && <span style={{ fontSize: 10, color: "var(--on-surface-variant)" }}>({f.memo})</span>}
                  <button onClick={() => deleteKeyword(f.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 통계 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "전체", value: stats.total, color: "var(--on-surface)" },
          { label: "공개", value: stats.published, color: "#2563eb" },
          { label: "비공개", value: stats.hidden, color: "#64748b" },
          { label: "주최기관 없음", value: stats.noOrg, color: "#ef4444" },
          { label: "이름 짧음", value: stats.shortName, color: "#d97706" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: "14px 16px", borderRadius: 10,
            background: "var(--surface-container-lowest)",
            border: "1px solid var(--surface-container-high)" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.65rem", fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--on-surface-variant)" }}>{label}</p>
            <p style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="행사명 검색..."
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: "0.82rem",
            border: "1px solid var(--surface-container-high)",
            background: "var(--surface-container-lowest)",
            color: "var(--on-surface)", outline: "none", width: 200,
          }}
        />
        {(["all", "published", "hidden"] as const).map((f) => (
          <button key={f} onClick={() => setStatusFilter(f)} style={{
            padding: "5px 12px", borderRadius: 20, fontSize: "0.75rem",
            fontWeight: 600, cursor: "pointer", border: "1px solid",
            borderColor: statusFilter === f ? "var(--on-surface)" : "var(--surface-container-high)",
            background: statusFilter === f ? "var(--on-surface)" : "transparent",
            color: statusFilter === f ? "var(--surface)" : "var(--on-surface-variant)",
          }}>
            { f === "all" ? "전체" : f === "published" ? "공개" : "비공개" }
          </button>
        ))}
        <select
          value={venueFilter}
          onChange={(e) => setVenueFilter(e.target.value)}
          style={{
            padding: "5px 10px", borderRadius: 8, fontSize: "0.78rem",
            border: "1px solid var(--surface-container-high)",
            background: "var(--surface-container-lowest)",
            color: "var(--on-surface)", cursor: "pointer",
          }}
        >
          {venues.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ fontSize: "0.75rem", color: "var(--on-surface-variant)", marginLeft: "auto" }}>
          {filtered.length}건
        </span>
      </div>

      {/* 테이블 */}
      <div style={{ borderRadius: 10, overflow: "hidden",
        border: "1px solid var(--surface-container-high)" }}>
        {/* 헤더 */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "40px 1fr 100px 140px 100px 80px 70px",
          padding: "8px 14px", gap: 8,
          background: "var(--surface-container)",
          fontSize: "0.68rem", fontWeight: 700,
          letterSpacing: "0.04em", textTransform: "uppercase",
          color: "var(--on-surface-variant)",
        }}>
          <span style={{ textAlign: "center" }}>No.</span>
          <span>행사명</span>
          <span>센터</span>
          <span>주최기관</span>
          <span>기간</span>
          <span>카테고리</span>
          <span>공개여부</span>
        </div>

        {/* 행 */}
        <div style={{ maxHeight: 600, overflowY: "auto" }}>
          {filtered.map((e, idx) => (
            <div key={e.id} style={{
              display: "grid",
              gridTemplateColumns: "40px 1fr 100px 140px 100px 80px 70px",
              padding: "9px 14px", gap: 8, alignItems: "center",
              borderTop: idx > 0 ? "1px solid var(--surface-container-high)" : "none",
              background: hasIssue(e) ? "#ef444406" : "var(--surface-container-lowest)",
            }}>
              {/* No. */}
              <span style={{ fontSize: "0.68rem", color: "var(--on-surface-variant)", textAlign: "center", display: "block" }}>
                {idx + 1}
              </span>

              {/* 행사명 */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {hasIssue(e) && (
                  <span title={[
                    !e.organizer && "주최기관 없음",
                    e.event_name.length <= 4 && "이름 짧음(짤림?)",
                    !e.category && "카테고리 없음",
                  ].filter(Boolean).join(", ")}
                    style={{ cursor: "help", flexShrink: 0 }}>⚠️</span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <EditableCell id={e.id} field="event_name" value={e.event_name} />
                </div>
              </div>

              {/* 센터 */}
              <div style={{ minWidth: 0 }}>
                <EditableCell id={e.id} field="venue" value={e.venue} />
              </div>

              {/* 주최기관 */}
              <div style={{ minWidth: 0 }}>
                <EditableCell id={e.id} field="organizer" value={e.organizer} />
              </div>

              {/* 기간 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <EditableCell id={e.id} field="start_date" value={e.start_date} type="date" />
                <EditableCell id={e.id} field="end_date" value={e.end_date} type="date" />
              </div>

              {/* 카테고리 */}
              <span style={{
                fontSize: "0.68rem", color: e.category ? "var(--on-surface-variant)" : "#ef4444",
              }}>
                {e.category ?? "없음"}
              </span>

              {/* 공개 여부 토글 */}
              <button
                onClick={() => togglePublish(e.id, e.is_published, e.event_name)}
                disabled={toggling === e.id}
                style={{
                  padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem",
                  fontWeight: 700, cursor: toggling === e.id ? "wait" : "pointer",
                  border: "none", opacity: toggling === e.id ? 0.5 : 1,
                  background: e.is_published ? "#2563eb18" : "#64748b18",
                  color: e.is_published ? "#2563eb" : "#64748b",
                  transition: "all 0.15s",
                }}
              >
                {e.is_published ? "공개" : "비공개"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────
export default function QualityDashboard({ news, events, sources }: Props) {
  const [tab, setTab] = useState<"news" | "events">("news");

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
      <div style={{ marginBottom: 28 }}>
        <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 600,
          letterSpacing: "0.08em", textTransform: "uppercase",
          color: "var(--on-surface-variant)" }}>
          Data Quality
        </p>
        <h2 style={{ margin: "4px 0 0", fontSize: "1.5rem", fontWeight: 700,
          letterSpacing: "-0.02em", color: "var(--on-surface)" }}>
          정합성 관리
        </h2>
      </div>

      {/* 탭 */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24,
        borderBottom: "1px solid var(--surface-container-high)", paddingBottom: 0 }}>
        {([
          { key: "news" as const, label: "📰 뉴스 정합성" },
          { key: "events" as const, label: "📅 행사 관리" },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 16px", border: "none", cursor: "pointer",
              fontSize: "0.82rem", fontWeight: tab === key ? 700 : 500,
              background: "transparent",
              color: tab === key ? "var(--on-surface)" : "var(--on-surface-variant)",
              borderBottom: `2px solid ${tab === key ? "var(--on-surface)" : "transparent"}`,
              marginBottom: -1,
              transition: "all 0.15s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "news" ? <NewsTab news={news} sources={sources} /> : <EventsTab initialEvents={events} />}

      <HelpPanel title="정합성 관리 가이드">
        <p style={{ marginBottom: 12 }}>
          뉴스 DB와 행사 데이터의 품질을 점검하고 관리합니다. 수치가 높을수록 콘텐츠 노출 품질에 직접 영향을 줍니다.
        </p>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>📰 뉴스 정합성 탭</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>빠진 필드</strong> — 카테고리 또는 요약(summary_short)이 없는 기사. 뉴스룸 리스트·검색에서 빈 카드로 노출될 수 있습니다. (이미지 없음은 로고 자동 대체되므로 이슈 아님)</li>
          <li><strong style={{ color: "var(--on-surface)" }}>URL 중복</strong> — 동일한 원문 URL이 2건 이상 저장된 경우. 큐레이션 보드에서 수동 삭제하거나 하단 중복 정리 기능을 활용하세요.</li>
          <li><strong style={{ color: "var(--on-surface)" }}>점수 불일치</strong> — 발행됐으나 품질점수 4점 미만이거나, 고품질(8점↑)이지만 미발행 상태인 기사. 검토 후 발행 여부를 조정하세요.</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>📊 사업영역 커버리지</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>발행 기사가 EZPMP 7개 사업영역(스마트립·글로컬 관광·AI 관광·MICE Tech·ATT·MEeT·AXDX) 키워드와 얼마나 겹치는지 비율로 표시합니다.</li>
          <li>건수/퍼센트에 마우스를 올리면 해당 도메인의 기사 목록(최대 8건)을 미리볼 수 있습니다.</li>
          <li><strong style={{ color: "var(--on-surface)" }}>미분류</strong> — 어느 도메인 키워드에도 매칭되지 않는 기사. 비율이 높으면 큐레이션 설정의 강조 키워드를 점검하거나 도메인 키워드 확장을 검토하세요.</li>
          <li>하나의 기사가 여러 도메인에 중복 카운트될 수 있습니다 (합계 &gt; 100% 가능).</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>📡 RSS 소스 분석</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>연관도 높음(✅)</strong> — AI·MICE·TOURISM 카테고리 소스. 사업영역과 직접 연관됩니다.</li>
          <li><strong style={{ color: "var(--on-surface)" }}>연관도 보통(⚠️)</strong> — 간접 연관 가능한 소스 (스타트업·정책 등).</li>
          <li><strong style={{ color: "var(--on-surface)" }}>연관도 낮음(❌)</strong> — 사업영역 외 가능성이 높은 소스. 비활성 전환을 검토하세요.</li>
          <li>활성/비활성 버튼으로 소스별 수집을 즉시 ON/OFF 할 수 있습니다.</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>📅 행사 관리 탭</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>⚠️ 아이콘이 있는 행은 주최기관 없음·이름 짧음(데이터 짤림 의심)·카테고리 없음 중 하나 이상의 이슈가 있습니다.</li>
          <li>공개/비공개 버튼으로 뉴스룸 행사 섹션 노출 여부를 즉시 전환합니다.</li>
          <li><strong style={{ color: "var(--on-surface)" }}>인라인 편집</strong> — 행사명·주최기관·시작일·종료일 셀을 클릭하면 바로 수정할 수 있습니다. Enter 또는 클릭 아웃 시 저장, ESC로 취소. 변경 즉시 DB에 반영됩니다.</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>🛠 수동 관리</p>
        <ul style={{ paddingLeft: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>행사 데이터 수집</strong> — 쇼알라·한국전시주최자협회에서 최신 행사를 크롤링합니다. 백그라운드 실행이라 버튼 클릭 후 1~2분 뒤 새로고침하면 결과를 확인할 수 있습니다.</li>
          <li><strong style={{ color: "var(--on-surface)" }}>중복/불량 정리</strong> — 미리보기로 삭제 예상 건수를 확인한 뒤 실행하세요. 노이즈 행사명(총회·웨딩·설명회 등) 삭제, 완전 중복 그룹에서 정보량이 낮은 행 삭제를 한번에 수행합니다. <strong style={{ color: "#ef4444" }}>실행 후 복원 불가.</strong></li>
          <li style={{ marginTop: 8 }}><strong style={{ color: "var(--on-surface)" }}>AKEI 엑셀 가져오기 (UI)</strong> — 한국전시산업진흥회(AKEI) 엑셀 파일을 업로드해 행사를 추가합니다.
            <ol style={{ paddingLeft: 16, marginTop: 4, lineHeight: 1.8 }}>
              <li>AKEI 사이트에서 전시행사 일정 엑셀을 다운로드합니다.</li>
              <li>수동 관리 패널 &gt; <em>AKEI 엑셀 가져오기</em> 영역에 파일을 업로드합니다.</li>
              <li><em>미리보기</em>로 신규·보강·중복 건수를 확인합니다.</li>
              <li><em>DB에 저장</em> 버튼을 눌러 확정합니다.</li>
            </ol>
            <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
              중복 처리 기준: (행사명 + 시작일)이 같으면 <strong>빈 필드만 보강</strong>하고 이미 채워진 데이터는 건드리지 않습니다.
            </span>
          </li>
          <li style={{ marginTop: 8 }}><strong style={{ color: "var(--on-surface)" }}>AKEI Python 스크립트 (직접 크롤링)</strong> — UI 없이 터미널에서 AKEI 사이트를 직접 크롤링해 Supabase에 저장합니다.
            <ol style={{ paddingLeft: 16, marginTop: 4, lineHeight: 1.8 }}>
              <li><code style={{ background: "var(--surface-variant)", padding: "1px 4px", borderRadius: 3 }}>cd app-src/docs</code> 로 이동합니다.</li>
              <li>먼저 <strong>미리보기</strong>로 확인: <code style={{ background: "var(--surface-variant)", padding: "1px 4px", borderRadius: 3 }}>py exhibition_crawler.py --dry-run</code></li>
              <li>확인 후 <strong>실제 저장</strong>: <code style={{ background: "var(--surface-variant)", padding: "1px 4px", borderRadius: 3 }}>py exhibition_crawler.py</code></li>
            </ol>
            <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)", display: "block", marginTop: 4 }}>
              기본값: 현재 연도 · 이번 달부터 크롤링 (과거 데이터 재수집 불필요).
              특정 월부터 지정하려면 <code style={{ background: "var(--surface-variant)", padding: "1px 4px", borderRadius: 3 }}>--from-month 3</code> 옵션을 추가하세요.
              중복 처리 기준은 UI와 동일 (빈 필드 보강, 기존 데이터 보존).
            </span>
          </li>
        </ul>
      </HelpPanel>
    </div>
  );
}
