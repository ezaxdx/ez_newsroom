import { createAdminClient } from "@/lib/supabase/admin";
import HelpPanel from "@/components/admin/HelpPanel";
import DateRangePicker from "./DateRangePicker";

/* ── 빈 데이터 기본값 ── */
const EMPTY = {
  totals: { view: 0, detail_view: 0, outbound_click: 0, event_click: 0 },
  funnel: [
    { label: "메인 접속",  count: 0, pct: 100 },
    { label: "기사 클릭",  count: 0, pct: 0 },
    { label: "원문 클릭",  count: 0, pct: 0 },
  ],
  referrers:    [] as { source: string; count: number }[],
  internalNavCount: 0,
  utmCampaigns: [] as { campaign: string; count: number }[],
  categories:   [] as { category: string; page_views: number; detail_views: number; outbound: number; avg_read_sec: number }[],
  topArticles:  [] as { title: string; category: string; detail_views: number; outbound: number }[],
  topSearches:  [] as { query: string; count: number }[],
  topEvents:    [] as { name: string; venue: string | null; clicks: number }[],
  avgReadSec:   0,
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

// UTM이 없을 때 document.referrer 호스트로 유입경로 추정 (사내 포털 등 UTM을 못 붙이는 채널용)
const REFERRER_HOST_LABEL: { match: string; label: string }[] = [
  { match: "aigate.ezpmp.co.kr", label: "사내 AIGate" },
];

// 사람이 아닌 자동화 트래픽(링크 미리보기 봇·모니터링·헤드리스 크롤러) 판별용 — 직접 접속과 구분 표시
const BOT_UA_PATTERN = /bot|crawler|spider|headlesschrome|vercel-screenshot|google-app-companion/i;

function getSiteHost(): string {
  try { return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app").hostname; }
  catch { return ""; }
}

/** utm_source 우선, 없으면 referrer 호스트로 유입경로 판별. 봇 UA는 별도 라벨로 분리. 둘 다 없으면 직접 접속 */
function detectSource(utmSource: string | null, referrer: string | null, siteHost: string, userAgent: string | null): string {
  if (userAgent && BOT_UA_PATTERN.test(userAgent)) return "봇/크롤러(자동수집)";
  if (utmSource) {
    const raw = utmSource.toLowerCase();
    return SOURCE_LABEL[raw] ?? utmSource; // 매핑 없는 커스텀 utm 값은 원문 그대로 표시
  }
  if (referrer) {
    try {
      const host = new URL(referrer).hostname;
      if (!host || host === siteHost) return "직접 접속"; // 자기 사이트 내 이동은 direct 취급
      const known = REFERRER_HOST_LABEL.find((k) => host.includes(k.match));
      return known ? known.label : host; // 매핑 없는 외부 도메인은 호스트명 그대로
    } catch { /* 잘못된 referrer 값 */ }
  }
  return "직접 접속";
}

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
      { count: eventClickCount },
      { data: articles },
      { data: detailLogs },    // detail_view with news_id → 카테고리/기사 집계
      { data: outboundLogs },  // outbound_click with news_id
      { data: readLogs },      // read_time with read_sec (기사 모달 열람 — 카테고리별 성과용)
      { data: sessionLogs },   // session_time with read_sec (홈 화면 전체 체류 — KPI 카드용)
      { data: catViewLogs },   // view with category (아카이브 페이지)
      { data: sourceLogs },    // 유입 경로 판별용 — view 전체(category로 홈 진입/아카이브 이동 구분)
      { data: searchLogs },    // 검색어
      { data: eventClickLogs },// event_click with event_id → 인기 행사 집계
    ] = await Promise.all([
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "view"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "detail_view"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "outbound_click"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "event_click"), from, to),
      db.from("news").select("id, title, category"),
      applyDate(db.from("user_logs").select("news_id").eq("event_type", "detail_view").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("news_id").eq("event_type", "outbound_click").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("news_id, read_sec").eq("event_type", "read_time").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("read_sec").eq("event_type", "session_time").not("read_sec", "is", null).limit(5000), from, to),
      // 아카이브 방문 = 카테고리 아카이브 페이지(/category/X)를 연 것 (view + category)
      // ※ 과거 category_view(홈 피드 노출) 이벤트는 사실상 홈 방문 수와 동일해 신호가 없어 집계에서 제외
      applyDate(db.from("user_logs").select("category").eq("event_type", "view").not("category", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("utm_source, utm_campaign, referrer, user_agent, category").eq("event_type", "view").limit(5000), from, to),
      applyDate(db.from("user_logs").select("search_query").eq("event_type", "search").not("search_query", "is", null).limit(2000), from, to),
      applyDate(db.from("user_logs").select("event_id").eq("event_type", "event_click").not("event_id", "is", null).limit(5000), from, to),
    ]);

    const viewCount     = view    ?? 0;
    const detailCount   = detail_view ?? 0;
    const outboundCount = outbound ?? 0;
    const eventClickTotal = eventClickCount ?? 0;
    if (viewCount === 0 && detailCount === 0) return EMPTY;

    // ── 유입 경로 (홈 첫 진입만 — "어떻게 사이트에 들어왔나") ──
    // category 없는 view = 홈 첫 진입(유입). category 있는 view = 아카이브 카테고리 이동(사이트 내 이동).
    // 사이트 내 이동은 유입이 아니라 "사용자 여정"이라 유입경로 집계에서 제외(카테고리별 성과·퍼널에 이미 잡힘).
    const siteHost = getSiteHost();
    const entryLogs = (sourceLogs ?? []).filter((l: { category: string | null }) => !l.category);
    const internalNavCount = (sourceLogs ?? []).length - entryLogs.length;
    const refMap: Record<string, number> = {};
    for (const log of entryLogs) {
      const label = detectSource(log.utm_source, log.referrer, siteHost, log.user_agent);
      refMap[label] = (refMap[label] ?? 0) + 1;
    }
    const referrers = Object.entries(refMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // ── UTM 캠페인 (홈 첫 진입 중 utm_source가 있는 것만) ──
    const campMap: Record<string, number> = {};
    for (const log of entryLogs) {
      if (!log.utm_source) continue;
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
      avg_read_sec: catReadSecs[cat]?.length
        ? Math.round(catReadSecs[cat].reduce((a, b) => a + b, 0) / catReadSecs[cat].length)
        : 0,
    })).sort((a, b) => b.detail_views - a.detail_views);

    // ── 전체 평균 체류시간 (홈 화면 진입~이탈 전체 세션 기준, session_time) ──
    const allSessionSecs: number[] = (sessionLogs ?? [])
      .map((l: { read_sec: number | null }) => Number(l.read_sec))
      .filter((n: number) => !isNaN(n) && n > 0);
    const avgReadSec = allSessionSecs.length ? Math.round(allSessionSecs.reduce((a, b) => a + b, 0) / allSessionSecs.length) : 0;

    // ── 인기 행사 TOP 5 (행사 캘린더 클릭) ──
    const eventClickCounts: Record<string, number> = {};
    for (const log of eventClickLogs ?? []) eventClickCounts[log.event_id] = (eventClickCounts[log.event_id] ?? 0) + 1;
    const eventIds = Object.keys(eventClickCounts);
    let topEvents: { name: string; venue: string | null; clicks: number }[] = [];
    if (eventIds.length) {
      const { data: eventsData } = await db.from("convention_events").select("id, event_name, venue").in("id", eventIds);
      const eventMap = new Map((eventsData ?? []).map((e) => [e.id, e]));
      topEvents = Object.entries(eventClickCounts)
        .map(([id, clicks]) => {
          const ev = eventMap.get(id);
          return { name: ev?.event_name ?? "(삭제된 행사)", venue: ev?.venue ?? null, clicks };
        })
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 5);
    }

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
      totals: { view: viewCount, detail_view: detailCount, outbound_click: outboundCount, event_click: eventClickTotal },
      funnel: [
        { label: "메인 접속", count: viewCount,     pct: 100 },
        { label: "기사 클릭", count: detailCount,   pct: viewCount ? +((detailCount   / viewCount) * 100).toFixed(1) : 0 },
        { label: "원문 클릭", count: outboundCount, pct: viewCount ? +((outboundCount / viewCount) * 100).toFixed(1) : 0 },
      ],
      referrers,
      internalNavCount,
      utmCampaigns: utmCampaigns.length ? utmCampaigns : [],
      categories,
      topArticles,
      topSearches,
      topEvents,
      avgReadSec,
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
  const { totals, funnel, referrers, utmCampaigns, topArticles, topSearches, topEvents, avgReadSec } = data;
  const internalNavCount = (data as { internalNavCount?: number }).internalNavCount ?? 0;

  // 카테고리 성과: navCategories 전체를 기준으로 항상 표시 (데이터 없으면 0)
  const categories = navCategories.map((cat) => {
    const found = data.categories.find((c) => c.category === cat);
    return found ?? { category: cat, page_views: 0, detail_views: 0, outbound: 0, avg_read_sec: 0 };
  });

  const detailRate   = totals.view ? ((totals.detail_view    / totals.view) * 100).toFixed(1) : "0";
  const outboundRate = totals.view ? ((totals.outbound_click / totals.view) * 100).toFixed(1) : "0";
  const maxRef       = Math.max(1, ...referrers.map((r) => r.count));
  const maxSearch    = Math.max(1, ...topSearches.map((s) => s.count));

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
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="총 접속 수" value={totals.view} />
        <StatCard label="기사 클릭" value={totals.detail_view} sub={`전환율 ${detailRate}%`} />
        <StatCard label="원문 클릭" value={totals.outbound_click} sub={`전환율 ${outboundRate}%`} />
        <StatCard label="행사 클릭" value={totals.event_click} sub="EZPMP 픽 캘린더" />
        <StatCard label="평균 체류시간" value={`${avgReadSec}초`} sub="홈 화면 전체 체류 · 데이터 수집 중" />
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
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-1 m-0"
            style={{ color: "var(--on-surface-variant)" }}>유입 경로 (Referrer)</p>
          <p className="text-[0.68rem] mb-5 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
            홈 첫 진입 기준 · 어떻게 사이트에 들어왔는지
          </p>
          {referrers.length === 0 && (
            <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
              유입 데이터가 없습니다.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {referrers.map((r) => (
              <div key={r.source}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">
                    {r.source}
                    {r.source === "봇/크롤러(자동수집)" && (
                      <span className="text-xs ml-1.5" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
                        (사람 아님 · 카톡 미리보기·모니터링 등)
                      </span>
                    )}
                  </span>
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
          {internalNavCount > 0 && (
            <p className="text-[0.68rem] mt-4 pt-3 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6, borderTop: "1px solid var(--surface-container-highest)" }}>
              ※ 사이트 내 이동(아카이브 카테고리 탐색) {internalNavCount.toLocaleString()}회는 유입이 아니라 사용자 여정 — 카테고리별 성과·퍼널에서 확인
            </p>
          )}
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
          카테고리별 콘텐츠 소비 (홈·아카이브 경로 무관 합산) · 평균 체류(초)는 데이터 수집 중
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                {["카테고리", "기사 클릭", "원문 클릭", "평균 체류(초)"].map((h) => (
                  <th key={h} className="text-left pb-3 pr-4 text-[0.7rem] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--on-surface-variant)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                return (
                  <tr key={cat.category} style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                    <td className="py-3 pr-4 font-semibold">
                      <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold tracking-wide uppercase"
                        style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
                        {cat.category}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{cat.detail_views.toLocaleString()}</td>
                    <td className="py-3 pr-4">{cat.outbound.toLocaleString()}</td>
                    <td className="py-3 pr-4">{cat.avg_read_sec ? cat.avg_read_sec.toLocaleString() : "-"}</td>
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

      {/* ── 인기 행사 (EZPMP 픽 캘린더 클릭) ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
          style={{ color: "var(--on-surface-variant)" }}>인기 행사 TOP 5</p>
        {topEvents.length === 0 ? (
          <p className="text-sm text-center py-8 m-0" style={{ color: "var(--on-surface-variant)" }}>
            아직 행사 클릭 데이터가 없습니다.
          </p>
        ) : (
          <div className="flex flex-col">
            {topEvents.map((ev, idx) => (
              <div key={ev.name} className="flex items-center gap-4 py-3"
                style={{ borderBottom: idx < topEvents.length - 1 ? "1px solid var(--surface-container-highest)" : "none" }}>
                <span className="text-lg font-bold w-6 flex-shrink-0" style={{ color: "var(--on-surface-variant)" }}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium m-0 truncate">{ev.name}</p>
                  {ev.venue && (
                    <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>📍 {ev.venue}</span>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>클릭</p>
                  <p className="text-sm font-bold m-0">{ev.clicks}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <HelpPanel title="애널리틱스 가이드">
        <p style={{ marginBottom: 16 }}>
          뉴스룸 독자의 행동 데이터를 자동 수집·분석합니다. 별도 설정 없이 방문자 발생 시 즉시 기록됩니다.
        </p>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>1. KPI 카드</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>총 접속 수</strong> — 메인 페이지(뉴스룸 홈) 방문 횟수. 새로고침·재방문 포함</li>
          <li><strong style={{ color: "var(--on-surface)" }}>기사 클릭</strong> — 기사 카드를 눌러 요약·인사이트 모달을 열람한 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>원문 클릭</strong> — 모달 내 "VIEW ORIGINAL SOURCE" 클릭 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>전체 전환율</strong> — 메인 접속 대비 원문 클릭 비율 (접속 → 원문 클릭)</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>2. 인게이지먼트 퍼널</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>메인 접속</strong> → <strong style={{ color: "var(--on-surface)" }}>기사 클릭</strong> → <strong style={{ color: "var(--on-surface)" }}>원문 클릭</strong> 순으로 전환율 확인</li>
          <li>기사 클릭률이 높을수록 콘텐츠 제목·요약의 흡입력이 좋은 것</li>
          <li>원문 클릭률이 높을수록 인사이트 콘텐츠 품질이 높은 것</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>3. 트래픽 소스</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>UTM 파라미터가 있으면 우선 사용 (카카오톡, 뉴스레터, SNS 등)</li>
          <li>UTM이 없으면 브라우저가 보내는 referrer(어디서 왔는지) 도메인으로 자동 판별 — 사내 AIGate처럼 링크에 UTM을 못 붙이는 경로도 잡힘</li>
          <li>링크 예시: <code style={{ fontSize: 11, background: "var(--surface-container-high)", padding: "1px 5px", borderRadius: 3 }}>?utm_source=kakao&amp;utm_campaign=weekly</code></li>
          <li><strong style={{ color: "var(--on-surface)" }}>봇/크롤러(자동수집)</strong> — 실제 사람이 아니라 시스템이 자동으로 페이지를 렌더링한 접속. 사람 트래픽과 구분해 표시하지만 총 접속 수 집계에서 제외되진 않음
            <ul style={{ paddingLeft: 16, marginTop: 4 }}>
              <li>카카오톡·슬랙·카카오뷰 등에 링크를 공유하면 메신저 서버가 미리보기용으로 한 번 접속 (링크 미리보기 봇)</li>
              <li>사이트가 살아있는지 주기적으로 확인하는 모니터링/업타임 체크 봇</li>
              <li>Playwright·Puppeteer 등 SEO 크롤러·자동화 테스트 툴</li>
            </ul>
          </li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>4. 카테고리별 성과</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>카테고리별 <strong style={{ color: "var(--on-surface)" }}>콘텐츠 소비</strong>를 봅니다 (홈 피드·아카이브 등 경로 무관 합산). 어디서 소비됐는지(지점별) 상세는 로그에 쌓이고 있어 필요 시 추가 가능</li>
          <li><strong style={{ color: "var(--on-surface)" }}>기사 클릭</strong> — 해당 카테고리 기사를 클릭해 모달을 열람한 횟수</li>
          <li><strong style={{ color: "var(--on-surface)" }}>원문 클릭</strong> — 해당 카테고리 기사에서 원문으로 이동한 횟수</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>5. 인기 검색어</p>
        <ul style={{ paddingLeft: 16, marginBottom: 16 }}>
          <li>뉴스룸 상단 검색창에서 실행된 검색어를 빈도순으로 집계</li>
          <li>독자가 관심 갖는 키워드 파악 및 콘텐츠 기획에 활용</li>
        </ul>

        <p style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "var(--on-surface)" }}>6. 행사 클릭 · 평균 체류시간</p>
        <ul style={{ paddingLeft: 16 }}>
          <li><strong style={{ color: "var(--on-surface)" }}>행사 클릭</strong> — 홈·행사 캘린더의 EZPMP 픽 카드를 클릭한 횟수. 인기 행사 TOP 5로 어떤 픽이 실제 반응 좋은지 확인 가능</li>
          <li><strong style={{ color: "var(--on-surface)" }}>평균 체류시간</strong> — 홈 화면에 진입한 순간부터 이탈(탭 닫기·다른 사이트 이동·다른 페이지 이동)할 때까지의 전체 체류 시간(초). 탭이 백그라운드에 있는 동안은 카운트 제외</li>
          <li>카테고리별 성과 표의 "평균 체류(초)"는 이것과 다름 — 해당 카테고리 기사의 인사이트 모달을 열어본 평균 시간만 별도로 집계</li>
          <li style={{ marginTop: 6 }}><strong style={{ color: "var(--on-surface)" }}>어떻게 측정하나</strong>
            <ul style={{ paddingLeft: 16, marginTop: 4 }}>
              <li>홈 화면 진입 시점에 타이머 시작, 탭이 백그라운드로 전환되면(Page Visibility API) 자동으로 일시정지 — 딴 짓하는 시간은 제외</li>
              <li>탭을 닫거나 다른 사이트로 이동하면(pagehide) <code style={{ fontSize: 11, background: "var(--surface-container-high)", padding: "1px 5px", borderRadius: 3 }}>navigator.sendBeacon()</code>으로 마지막 순간까지 반영해 전송 — 일반 요청과 달리 페이지가 사라져도 유실 없이 도착</li>
              <li>사이트 내 다른 화면으로 이동(카테고리 페이지 등)해도 벗어나는 순간 지금까지 누적된 시간을 기록</li>
              <li>자리비움 등으로 인한 이상치 방지를 위해 최대 30분까지만 인정</li>
            </ul>
          </li>
        </ul>
      </HelpPanel>
    </div>
  );
}
