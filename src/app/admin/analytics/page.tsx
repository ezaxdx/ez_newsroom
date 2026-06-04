import { createAdminClient } from "@/lib/supabase/admin";
import HelpPanel from "@/components/admin/HelpPanel";
import DateRangePicker from "./DateRangePicker";

/* ── 빈 데이터 기본값 ── */
const EMPTY = {
  totals: { view: 0, detail_view: 0, outbound_click: 0 },
  funnel: [
    { label: "메인 접속",  count: 0, pct: 100 },
    { label: "기사 클릭",  count: 0, pct: 0 },
    { label: "원문 클릭",  count: 0, pct: 0 },
  ],
  referrers:    [] as { source: string; count: number }[],
  utmCampaigns: [] as { campaign: string; count: number }[],
  categories:   [] as { category: string; page_views: number; detail_views: number; outbound: number }[],
  topArticles:  [] as { title: string; category: string; detail_views: number; outbound: number }[],
  topSearches:  [] as { query: string; count: number }[],
};

const SOURCE_LABEL: Record<string, string> = {
  newsletter:  "뉴스레터",
  kakao:       "카카오톡",
  kakaotalk:   "카카오톡",
  linkedin:    "LinkedIn",
  twitter:     "Twitter / X",
  x:           "Twitter / X",
  instagram:   "Instagram",
  facebook:    "Facebook",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyDate(query: any, from: string | null, to: string | null) {
  if (from) query = query.gte("created_at", from + "T00:00:00");
  if (to)   query = query.lte("created_at", to   + "T23:59:59");
  return query;
}

async function fetchAnalytics(from: string | null = null, to: string | null = null) {
  try {
    const db = createAdminClient();

    // ── 이벤트 타입별 카운트 (HEAD 요청 = 데이터 전송 없음) ──
    const [
      { count: view },
      { count: detail_view },
      { count: outbound },
      { data: articles },
      { data: detailLogs },   // detail_view with news_id → 카테고리/기사 집계
      { data: outboundLogs }, // outbound_click with news_id
      { data: readLogs },     // read_time with read_sec
      { data: catViewLogs },  // view with category (아카이브 페이지)
      { data: utmLogs },      // utm 유입 경로
      { data: searchLogs },   // 검색어
    ] = await Promise.all([
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "view"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "detail_view"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "outbound_click"), from, to),
      db.from("news").select("id, title, category"),
      applyDate(db.from("user_logs").select("news_id").eq("event_type", "detail_view").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("news_id").eq("event_type", "outbound_click").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("news_id, read_sec").eq("event_type", "read_time").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("category").eq("event_type", "view").not("category", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("utm_source, utm_campaign").not("utm_source", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("search_query").eq("event_type", "search").not("search_query", "is", null).limit(2000), from, to),
    ]);

    const viewCount    = view    ?? 0;
    const detailCount  = detail_view ?? 0;
    const outboundCount = outbound ?? 0;
    if (viewCount === 0 && detailCount === 0) return EMPTY;

    // ── 유입 경로 ──
    const refMap: Record<string, number> = {};
    for (const log of utmLogs ?? []) {
      const raw   = (log.utm_source ?? "").toLowerCase();
      const label = SOURCE_LABEL[raw] ?? "직접 접속";
      refMap[label] = (refMap[label] ?? 0) + 1;
    }
    const referrers = Object.entries(refMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // ── UTM 캠페인 ──
    const campMap: Record<string, number> = {};
    for (const log of utmLogs ?? []) {
      const camp = log.utm_campaign ?? "(없음)";
      campMap[camp] = (campMap[camp] ?? 0) + 1;
    }
    const utmCampaigns = Object.entries(campMap)
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count)
      .filter(({ campaign }) => campaign !== "(없음)")
      .slice(0, 10);

    // ── 카테고리별 성과 ──
    const articleMap = new Map((articles ?? []).map((a) => [a.id, a]));
    const catPageViews: Record<string, number>   = {};
    const catDetails:   Record<string, number>   = {};
    const catOut:       Record<string, number>   = {};
    const catReadSecs:  Record<string, number[]> = {};

    for (const log of catViewLogs ?? []) {
      if (log.category) catPageViews[log.category] = (catPageViews[log.category] ?? 0) + 1;
    }
    for (const log of detailLogs ?? []) {
      const art = articleMap.get(log.news_id);
      if (art?.category) catDetails[art.category] = (catDetails[art.category] ?? 0) + 1;
    }
    for (const log of outboundLogs ?? []) {
      const art = articleMap.get(log.news_id);
      if (art?.category) catOut[art.category] = (catOut[art.category] ?? 0) + 1;
    }
    for (const log of readLogs ?? []) {
      const art = articleMap.get(log.news_id);
      if (art?.category && log.read_sec) {
        if (!catReadSecs[art.category]) catReadSecs[art.category] = [];
        catReadSecs[art.category].push(Number(log.read_sec));
      }
    }

    const allCats = new Set([...Object.keys(catPageViews), ...Object.keys(catDetails)]);
    const categories = Array.from(allCats).map((cat) => ({
      category:     cat,
      page_views:   catPageViews[cat] ?? 0,
      detail_views: catDetails[cat]   ?? 0,
      outbound:     catOut[cat]       ?? 0,
    })).sort((a, b) => b.detail_views - a.detail_views);

    // ── 인기 기사 TOP 5 ──
    const artDetails: Record<string, number> = {};
    const artOut:     Record<string, number> = {};
    for (const log of detailLogs ?? [])  artDetails[log.news_id] = (artDetails[log.news_id] ?? 0) + 1;
    for (const log of outboundLogs ?? []) artOut[log.news_id]    = (artOut[log.news_id]    ?? 0) + 1;
    const topArticles = Object.entries(artDetails)
      .map(([id, dv]) => {
        const art = articleMap.get(id);
        return { title: art?.title ?? "(삭제된 기사)", category: art?.category ?? "-", detail_views: dv, outbound: artOut[id] ?? 0 };
      })
      .sort((a, b) => b.detail_views - a.detail_views)
      .slice(0, 5);

    // ── 인기 검색어 ──
    const queryMap: Record<string, number> = {};
    for (const log of searchLogs ?? []) {
      const q = log.search_query.trim().toLowerCase();
      if (q) queryMap[q] = (queryMap[q] ?? 0) + 1;
    }
    const topSearches = Object.entries(queryMap)
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totals: { view: viewCount, detail_view: detailCount, outbound_click: outboundCount },
      funnel: [
        { label: "메인 접속", count: viewCount,     pct: 100 },
        { label: "기사 클릭", count: detailCount,   pct: viewCount ? +((detailCount   / viewCount) * 100).toFixed(1) : 0 },
        { label: "원문 클릭", count: outboundCount, pct: viewCount ? +((outboundCount / viewCount) * 100).toFixed(1) : 0 },
      ],
      referrers:    referrers.length    ? referrers    : [{ source: "직접 접속", count: viewCount }],
      utmCampaigns: utmCampaigns.length ? utmCampaigns : [],
      categories,
      topArticles,
      topSearches,
    };
  } catch {
    return EMPTY;
  }
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-5 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
      <p className="text-[0.7rem] font-semibold tracking-[0.05em] uppercase m-0 mb-1"
        style={{ color: "var(--on-surface-variant)" }}>{label}</p>
      <p className="text-3xl font-bold tracking-tight m-0">{value.toLocaleString()}</p>
      {sub && <p className="text-xs mt-1 m-0" style={{ color: "var(--on-surface-variant)" }}>{sub}</p>}
    </div>
  );
}

async function fetchNavCategories(): Promise<string[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("nav_categories")
      .limit(1)
      .single();
    return data?.nav_categories ?? ["AI", "MICE", "TOURISM"];
  } catch {
    return ["AI", "MICE", "TOURISM"];
  }
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { from, to } = await searchParams;
  const [data, navCategories] = await Promise.all([fetchAnalytics(from ?? null, to ?? null), fetchNavCategories()]);
  const { totals, funnel, referrers, utmCampaigns, topArticles, topSearches } = data;

  // 카테고리 성과: navCategories 전체를 기준으로 항상 표시 (데이터 없으면 0)
  const categories = navCategories.map((cat) => {
    const found = data.categories.find((c) => c.category === cat);
    return found ?? { category: cat, page_views: 0, detail_views: 0, outbound: 0 };
  });

  const detailRate   = totals.view ? ((totals.detail_view    / totals.view) * 100).toFixed(1) : "0";
  const outboundRate = totals.view ? ((totals.outbound_click / totals.view) * 100).toFixed(1) : "0";
  const maxRef       = Math.max(1, ...referrers.map((r) => r.count));
  const maxSearch    = Math.max(1, ...topSearches.map((s) => s.count));
  const maxCat       = Math.max(1, ...categories.map((c) => c.detail_views));

  return (
    <div className="p-8 max-w-5xl flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0">애널리틱스</h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            사용자 여정 · 유입 경로 · 카테고리 성과
          </p>
        </div>
        <DateRangePicker />
      </div>

      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="총 접속 수" value={totals.view} />
        <StatCard label="기사 클릭" value={totals.detail_view} sub={`전환율 ${detailRate}%`} />
        <StatCard label="원문 클릭" value={totals.outbound_click} sub={`전환율 ${outboundRate}%`} />
        <StatCard label="전체 전환율" value={`${outboundRate}%`} sub="접속 → 원문 클릭" />
      </div>

      {/* ── 인게이지먼트 퍼널 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
          style={{ color: "var(--on-surface-variant)" }}>
          인게이지먼트 퍼널
        </p>
        <div className="flex flex-col gap-4">
          {funnel.map((step, idx) => (
            <div key={step.label} className="flex items-center gap-4">
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[0.65rem] font-bold"
                style={{ background: "var(--primary)", color: "#fff" }}>
                {idx + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium">{step.label}</span>
                  <span className="text-sm font-bold">{step.count.toLocaleString()}
                    <span className="text-xs font-normal ml-1.5" style={{ color: "var(--on-surface-variant)" }}>
                      ({step.pct}%)
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-container-highest)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${step.pct}%`,
                      background: idx === 0 ? "var(--primary)" : idx === 1 ? "#3b3b3b" : "#6b6b6b",
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 유입 경로 + UTM 캠페인 ── */}
      <div className="grid grid-cols-2 gap-5">
        {/* 유입 경로 */}
        <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
            style={{ color: "var(--on-surface-variant)" }}>유입 경로 (Referrer)</p>
          {referrers.length === 0 && (
            <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
              유입 데이터가 없습니다.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {referrers.map((r) => (
              <div key={r.source}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">{r.source}</span>
                  <span className="text-sm font-semibold">{r.count.toLocaleString()}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-container-highest)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(r.count / maxRef) * 100}%`, background: "var(--primary)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* UTM 캠페인 */}
        <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
            style={{ color: "var(--on-surface-variant)" }}>UTM 캠페인</p>
          {utmCampaigns.length === 0 && (
            <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
              UTM 데이터가 없습니다.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {utmCampaigns.map((u) => (
              <div key={u.campaign} className="flex items-center justify-between py-2"
                style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                <span className="text-sm font-mono truncate max-w-[180px]">{u.campaign}</span>
                <span className="text-sm font-semibold ml-2">{u.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── 카테고리별 성과 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-1 m-0"
          style={{ color: "var(--on-surface-variant)" }}>카테고리별 성과</p>
        <p className="text-[0.68rem] mb-5 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
          접속 수 = 카테고리 아카이브 페이지 방문 / 관심도 = 기사 클릭 기준 상대적 참여 비율
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                {["카테고리", "접속 수", "기사 클릭", "전환율", "원문 클릭", "관심도"].map((h) => (
                  <th key={h} className="text-left pb-3 pr-4 text-[0.7rem] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--on-surface-variant)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const convRate = cat.page_views
                  ? ((cat.detail_views / cat.page_views) * 100).toFixed(1)
                  : "-";
                return (
                  <tr key={cat.category} style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                    <td className="py-3 pr-4 font-semibold">
                      <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold tracking-wide uppercase"
                        style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
                        {cat.category}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{cat.page_views.toLocaleString()}</td>
                    <td className="py-3 pr-4">{cat.detail_views.toLocaleString()}</td>
                    <td className="py-3 pr-4">{convRate === "-" ? "-" : `${convRate}%`}</td>
                    <td className="py-3 pr-4">{cat.outbound.toLocaleString()}</td>
                    <td className="py-3 pr-4 w-28">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-container-highest)" }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${(cat.detail_views / maxCat) * 100}%`, background: "var(--primary)" }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 인기 검색어 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
          style={{ color: "var(--on-surface-variant)" }}>인기 검색어 TOP 10</p>
        {topSearches.length === 0 ? (
          <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
            아직 검색 데이터가 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {topSearches.map((s, idx) => (
              <div key={s.query}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.65rem] font-bold w-4 flex-shrink-0"
                      style={{ color: "var(--on-surface-variant)" }}>
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium">{s.query}</span>
                  </div>
                  <span className="text-sm font-semibold">{s.count.toLocaleString()}회</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden ml-6" style={{ background: "var(--surface-container-highest)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(s.count / maxSearch) * 100}%`, background: "var(--primary)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 인기 기사 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
          style={{ color: "var(--on-surface-variant)" }}>인기 기사 TOP 5</p>
        {topArticles.length === 0 ? (
          <p className="text-sm text-center py-8 m-0" style={{ color: "var(--on-surface-variant)" }}>
            아직 기사 열람 데이터가 없습니다.
          </p>
        ) : null}
        <div className="flex flex-col">
          {topArticles.map((art, idx) => (
            <div key={art.title} className="flex items-center gap-4 py-3"
              style={{ borderBottom: idx < topArticles.length - 1 ? "1px solid var(--surface-container-highest)" : "none" }}>
              <span className="text-lg font-bold w-6 flex-shrink-0" style={{ color: "var(--on-surface-variant)" }}>
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium m-0 truncate">{art.title}</p>
                <span className="text-[0.65rem] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-sm mt-1 inline-block"
                  style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
                  {art.category}
                </span>
              </div>
              <div className="flex gap-5 flex-shrink-0 text-right">
                <div>
                  <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>클릭</p>
                  <p className="text-sm font-bold m-0">{art.detail_views}</p>
                </div>
                <div>
                  <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>원문</p>
                  <p className="text-sm font-bold m-0">{art.outbound}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <HelpPanel title="애널리틱스 가이드">
        <p style={{ marginBottom: 16 }}>
          뉴스룸 독자의 행동 데이터를 자동 수집·분석합니다. 별도 설정 없이 방문자 발생 시 즉시 기록됩니다.
        </p>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>KPI 카드</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>총 접속 수</strong> — 메인 페이지(뉴스룸 홈) 방문 횟수. 새로고침·재방문 포함</li>
          <li><strong style={{ color: "var(--on-surface)" }}>기사 클릭</strong> — 기사 카드를 눌러 요약·인사이트 모달을 열람한 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>원문 클릭</strong> — 모달 내 "VIEW ORIGINAL SOURCE" 클릭 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>전체 전환율</strong> — 메인 접속 대비 원문 클릭 비율 (접속 → 원문 클릭)</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>인게이지먼트 퍼널</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>메인 접속</strong> → <strong style={{ color: "var(--on-surface)" }}>기사 클릭</strong> → <strong style={{ color: "var(--on-surface)" }}>원문 클릭</strong> 순으로 전환율 확인</li>
          <li>기사 클릭률이 높을수록 콘텐츠 제목·요약의 흡입력이 좋은 것</li>
          <li>원문 클릭률이 높을수록 인사이트 콘텐츠 품질이 높은 것</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>카테고리별 성과</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>접속 수</strong> — 해당 카테고리 아카이브 페이지(/category/AI 등) 방문 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>기사 클릭</strong> — 해당 카테고리 기사를 클릭해 모달을 열람한 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>전환율</strong> — 카테고리 접속 대비 기사 클릭 비율. 접속 데이터가 없으면 "-"</li>
          <li><strong style={{ color: "var(--on-surface)" }}>원문 클릭</strong> — 해당 카테고리 기사에서 원문으로 이동한 횟수</li>
<li><strong style={{ color: "var(--on-surface)" }}>관심도</strong> — 기사 클릭 수 기준 카테고리 간 상대 비율. 가장 높은 카테고리가 100%</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>인기 검색어</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>뉴스룸 상단 검색창에서 실행된 검색어를 빈도순으로 집계</li>
          <li>독자가 관심 갖는 키워드 파악 및 콘텐츠 기획에 활용</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>트래픽 소스</p>
        <ul style={{ paddingLeft: 16 }}>
          <li>UTM 파라미터로 유입 채널 추적 (카카오톡, 뉴스레터, SNS 등)</li>
          <li>링크 예시: <code style={{ fontSize: 11, background: "var(--surface-container-high)", padding: "1px 5px", borderRadius: 3 }}>?utm_source=kakao&amp;utm_campaign=weekly</code></li>
        </ul>
      </HelpPanel>
    </div>
  );
}
