"use client";

import { useState, useMemo } from "react";
import { NewsItem } from "@/lib/types";
import type { RssSource } from "@/app/admin/quality/page";

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
    ],
  },
  {
    label: "글로컬 관광",
    color: "#10b981",
    keywords: [
      "글로컬", "글로벌 관광객", "다국어 관광", "로컬 브랜딩", "K-관광",
      "지역 체류", "국제행사 연계", "관광 스토리텔링", "지역 상생",
      "외래 관광객", "인바운드",
    ],
  },
  {
    label: "AI 관광",
    color: "#6366f1",
    keywords: [
      "AI 관광", "관광 챗봇", "개인화 추천", "여행 AI", "다국어 안내",
      "관광 데이터 분석", "스마트 관광 안내", "생성형 AI", "관광 운영 자동화",
      "여행 일정 추천", "AI 안내",
    ],
  },
  {
    label: "MICE Tech",
    color: "#f59e0b",
    keywords: [
      "MICE", "마이스", "O2MEET", "LeadX", "리드엑스", "행사 자동화",
      "전시 DX", "비즈니스 매칭", "하이브리드 행사", "컨벤션", "전시회",
      "박람회", "PCO", "컨퍼런스", "포럼", "행사 플랫폼", "SaaS", "CSAP",
    ],
  },
  {
    label: "ATT(관광 전시)",
    color: "#ec4899",
    keywords: [
      "All That Travel", "ATT", "관광 박람회", "관광 비즈니스", "관광 산업",
      "여행 트렌드", "관광 스타트업", "관광 네트워킹", "관광 B2B", "관광 체험",
      "지역 관광 홍보",
    ],
  },
  {
    label: "MEeT(의료 전시)",
    color: "#ef4444",
    keywords: [
      "MEeT", "Medical Emerging Technology", "의료기술", "디지털헬스",
      "의료기기", "헬스케어", "바이오", "메디컬 테크", "의료 컨퍼런스",
      "의료 전시", "글로벌 바이어", "투자 매칭", "의료", "healthcare",
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
  AI:         { level: "high", label: "AI 관광 · MICE Tech" },
  MICE:       { level: "high", label: "MICE Tech · ATT" },
  TOURISM:    { level: "high", label: "스마트립 · 글로컬 · ATT" },
  STARTUP:    { level: "mid",  label: "간접 연관 가능" },
  POLICY:     { level: "mid",  label: "간접 연관 가능" },
  OPERATIONS: { level: "low",  label: "사업영역 외 가능성" },
  INDUSTRY:   { level: "low",  label: "사업영역 외 가능성" },
};

// ── 뉴스 정합성 탭 ─────────────────────────────────────────────────
function NewsTab({ news, sources }: { news: NewsItem[]; sources: RssSource[] }) {
  const [issueFilter, setIssueFilter] = useState<"all" | "missing" | "dup" | "mismatch">("all");
  const [showUnclassified, setShowUnclassified] = useState(false);
  const [togglingSource, setTogglingSource] = useState<string | null>(null);
  const [sourceList, setSourceList] = useState<RssSource[]>(sources);

  const stats = useMemo(() => {
    const published = news.filter((n) => n.is_published);
    const pending = news.filter((n) => !n.is_published);
    const missingField = news.filter(
      (n) => !n.image_url || !n.category || !n.summary_short
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
    const unclassifiedItems: NewsItem[] = [];
    for (const n of published) {
      const text = `${n.title} ${n.summary_short ?? ""} ${n.category ?? ""}`;
      const domains = getDomains(text);
      if (domains.length === 0) unclassifiedItems.push(n);
      domains.forEach((d) => { counts[d] = (counts[d] ?? 0) + 1; });
    }
    return { counts, unclassifiedItems, total: published.length };
  }, [news]);

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
        if (!n.image_url) issues.push("이미지 없음");
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
            return (
              <div key={d.label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  fontSize: "0.75rem", marginBottom: 3 }}>
                  <span style={{ color: d.color, fontWeight: 600 }}>{d.label}</span>
                  <span style={{ color: "var(--on-surface-variant)" }}>{cnt}건 ({pct}%)</span>
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
            { key: "missing" as const, label: "빠진 필드", count: news.filter(n => !n.image_url || !n.category || !n.summary_short).length, color: "#ef4444" },
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

// ── 행사 관리 탭 ─────────────────────────────────────────────────
function EventsTab({ initialEvents }: { initialEvents: EventRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "hidden">("all");
  const [venueFilter, setVenueFilter] = useState("전체");
  const [toggling, setToggling] = useState<string | null>(null);

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

  async function togglePublish(id: string, current: boolean) {
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
      }
    } finally {
      setToggling(null);
    }
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
          gridTemplateColumns: "1fr 100px 140px 100px 80px 70px",
          padding: "8px 14px", gap: 8,
          background: "var(--surface-container)",
          fontSize: "0.68rem", fontWeight: 700,
          letterSpacing: "0.04em", textTransform: "uppercase",
          color: "var(--on-surface-variant)",
        }}>
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
              gridTemplateColumns: "1fr 100px 140px 100px 80px 70px",
              padding: "9px 14px", gap: 8, alignItems: "center",
              borderTop: idx > 0 ? "1px solid var(--surface-container-high)" : "none",
              background: hasIssue(e) ? "#ef444406" : "var(--surface-container-lowest)",
            }}>
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
                <span style={{
                  fontSize: "0.8rem", color: "var(--on-surface)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }} title={e.event_name}>
                  {e.event_name}
                </span>
              </div>

              {/* 센터 */}
              <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.venue}
              </span>

              {/* 주최기관 */}
              <span style={{
                fontSize: "0.72rem",
                color: e.organizer ? "var(--on-surface-variant)" : "#ef4444",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={e.organizer ?? undefined}>
                {e.organizer ?? "없음"}
              </span>

              {/* 기간 */}
              <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
                {fmtDate(e.start_date)}{e.end_date && e.end_date !== e.start_date ? ` ~ ${fmtDate(e.end_date)}` : ""}
              </span>

              {/* 카테고리 */}
              <span style={{
                fontSize: "0.68rem", color: e.category ? "var(--on-surface-variant)" : "#ef4444",
              }}>
                {e.category ?? "없음"}
              </span>

              {/* 공개 여부 토글 */}
              <button
                onClick={() => togglePublish(e.id, e.is_published)}
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
    </div>
  );
}
