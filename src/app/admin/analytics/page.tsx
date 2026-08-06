import { createAdminClient } from "@/lib/supabase/admin";
import { HelpProvider, HelpTriggerConnected, HelpPanelConnected, Section, Item, Indent, Def } from "@/components/admin/HelpPanel";
import SectionInfoModal from "@/components/admin/SectionInfoModal";
import DateRangePicker from "./DateRangePicker";

/* ── 빈 데이터 기본값 ── */
const EMPTY = {
  totals: { view: 0, detail_view: 0, outbound_click: 0, event_click: 0 },
  exploreFunnel: [
    { label: "메인 진입",  count: 0, pct: 100 },
    { label: "기사 클릭",  count: 0, pct: 0 },
    { label: "원문 클릭",  count: 0, pct: 0 },
  ],
  deeplinkFunnel: [
    { label: "딥링크 진입", count: 0, pct: 100 },
    { label: "기사 열람",   count: 0, pct: 0 },
    { label: "원문 클릭",   count: 0, pct: 0 },
  ],
  referrers:    [] as { source: string; count: number }[],
  previewCount: 0,
  utmCampaigns: [] as { campaign: string; count: number }[],
  categories:   [] as { category: string; page_views: number; detail_views: number; outbound: number; avg_read_sec: number }[],
  topArticles:  [] as { title: string; category: string; detail_views: number; outbound: number }[],
  topSearches:  [] as { query: string; count: number }[],
  topEvents:    [] as { name: string; venue: string | null; clicks: number }[],
  avgReadSec:   0,
  newsletterListViews: 0,
  newsletterListViewsFromEmail: 0,
  topNewsletterIssues: [] as { vol: number; count: number }[],
};

// 유입경로 라벨: "직접 클릭해 들어온 경로"임을 명확히 — 재방문·북마크는 '직접 접속'으로 잡히는 한계 반영
const SOURCE_LABEL: Record<string, string> = {
  newsletter:  "뉴스레터 클릭 유입",
  kakao:       "카카오톡 클릭 유입",
  kakaotalk:   "카카오톡 클릭 유입",
  linkedin:    "LinkedIn 클릭 유입",
  twitter:     "Twitter / X 클릭 유입",
  x:           "Twitter / X 클릭 유입",
  instagram:   "Instagram 클릭 유입",
  facebook:    "Facebook 클릭 유입",
};

// UTM이 없을 때 document.referrer 호스트로 유입경로 추정 (사내 포털 등 UTM을 못 붙이는 채널용)
const REFERRER_HOST_LABEL: { match: string; label: string }[] = [
  { match: "aigate.ezpmp.co.kr", label: "사내 AIGate 클릭 유입" },
];

// 사람이 아닌 자동화 트래픽(링크 미리보기 봇·모니터링·헤드리스 크롤러) 판별용 — 직접 접속과 구분 표시
const BOT_UA_PATTERN = /bot|crawler|spider|headlesschrome|vercel-screenshot|google-app-companion/i;

// 관리자·개발자가 테스트하는 Vercel 프리뷰/브랜치 배포 도메인 — 실사용자 유입이 아니므로
// 유입경로 순위표에서 제외하고 별도로만 집계 (봇과 달리 전체 페이지뷰 성격의 트래픽 자체가 아님)
const PREVIEW_SENTINEL = "__PREVIEW__";
function isPreviewHost(host: string, siteHost: string): boolean {
  return host !== siteHost && host.endsWith(".vercel.app");
}

function getSiteHost(): string {
  try { return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ez-newsroom.vercel.app").hostname; }
  catch { return ""; }
}

/** utm_source 우선, 없으면 referrer 호스트로 유입경로 판별. 봇 UA·프리뷰 배포는 별도 판별. 둘 다 없으면 직접 접속 */
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
      if (isPreviewHost(host, siteHost)) return PREVIEW_SENTINEL; // 프리뷰 배포 — 순위표에서 제외
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
      { count: viewDeeplink },
      { count: detailDeeplink },
      { count: outboundDeeplink },
      { data: articles },
      { data: detailLogs },    // detail_view with news_id → 카테고리/기사 집계
      { data: outboundLogs },  // outbound_click with news_id
      { data: readLogs },      // read_time with read_sec (기사 모달 열람 — 카테고리별 성과용)
      { data: sessionLogs },   // session_time with read_sec (홈 화면 전체 체류 — KPI 카드용)
      { data: catViewLogs },   // view with category (아카이브 페이지)
      { data: sourceLogs },    // 유입 경로 판별용 — view 전체(category로 홈 진입/아카이브 이동 구분)
      { data: searchLogs },    // 검색어
      { data: eventClickLogs },// event_click with event_id → 인기 행사 집계
      { data: newsletterArchiveLogs }, // newsletter_archive_view — 지난호 목록/상세 조회
    ] = await Promise.all([
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "view"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "detail_view"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "outbound_click"), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "event_click"), from, to),
      // 딥링크(뉴스레터 등 자동오픈) 여정 — 탐색형 퍼널과 분리 집계용
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "view").eq("via_deeplink", true), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "detail_view").eq("via_deeplink", true), from, to),
      applyDate(db.from("user_logs").select("*", { count: "exact", head: true }).eq("event_type", "outbound_click").eq("via_deeplink", true), from, to),
      db.from("news").select("id, title, category"),
      applyDate(db.from("user_logs").select("news_id").eq("event_type", "detail_view").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("news_id").eq("event_type", "outbound_click").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("news_id, read_sec").eq("event_type", "read_time").not("news_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("read_sec").eq("event_type", "session_time").not("read_sec", "is", null).limit(5000), from, to),
      // 아카이브 방문 = 카테고리 아카이브 페이지(/category/X)를 연 것 (view + category)
      // ※ 과거 category_view(홈 피드 노출) 이벤트는 사실상 홈 방문 수와 동일해 신호가 없어 집계에서 제외
      applyDate(db.from("user_logs").select("category").eq("event_type", "view").not("category", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("utm_source, utm_campaign, referrer, user_agent, category, via_deeplink").eq("event_type", "view").limit(5000), from, to),
      applyDate(db.from("user_logs").select("search_query").eq("event_type", "search").not("search_query", "is", null).limit(2000), from, to),
      applyDate(db.from("user_logs").select("event_id").eq("event_type", "event_click").not("event_id", "is", null).limit(5000), from, to),
      applyDate(db.from("user_logs").select("newsletter_vol, utm_source").eq("event_type", "newsletter_archive_view").limit(5000), from, to),
    ]);

    const viewCount     = view    ?? 0;
    const detailCount   = detail_view ?? 0;
    const outboundCount = outbound ?? 0;
    const eventClickTotal = eventClickCount ?? 0;
    if (viewCount === 0 && detailCount === 0) return EMPTY;

    // ── 탐색형 vs 딥링크 퍼널 분리 ──
    // 딥링크(뉴스레터 등 ?news=id) 진입은 도착 즉시 모달이 자동으로 뜨므로 "기사 클릭"이 항상 100%에 가까움.
    // 탐색형(직접 클릭) 여정과 섞으면 실제 콘텐츠 매력도 신호가 왜곡되어 퍼널을 둘로 나눠 집계.
    const dlView    = viewDeeplink    ?? 0;
    const dlDetail  = detailDeeplink  ?? 0;
    const dlOutbound = outboundDeeplink ?? 0;
    const orgDetail  = Math.max(0, detailCount - dlDetail);
    const orgOutbound = Math.max(0, outboundCount - dlOutbound);
    const pct = (n: number, base: number) => base ? +((n / base) * 100).toFixed(1) : 0;

    // category 없는 view = 메인(홈) 페이지 첫 진입. category 있는 view = 아카이브·행사 캘린더 등 다른 탭 이동.
    const entryLogs = (sourceLogs ?? []).filter((l: { category: string | null }) => !l.category);

    // ── 유입 경로 (홈 첫 진입만 — "어떻게 사이트에 들어왔나") ──
    // 사이트 내 이동은 유입이 아니라 "사용자 여정"이라 유입경로 집계에서 제외(카테고리별 성과·퍼널에 이미 잡힘).
    // "메인 진입"(탐색형 퍼널)도 같은 entryLogs를 기준으로 계산 — 관리자 프리뷰 테스트 접속은 여기서도 동일하게 제외하고,
    // 딥링크(뉴스레터 등 자동 오픈) 진입만 별도 제외해 "직접 메인페이지에 들어와 둘러본" 진짜 탐색형만 집계한다.
    const siteHost = getSiteHost();
    const refMap: Record<string, number> = {};
    let previewCount = 0;
    let orgView = 0;
    for (const log of entryLogs) {
      const label = detectSource(log.utm_source, log.referrer, siteHost, log.user_agent);
      if (label === PREVIEW_SENTINEL) { previewCount++; continue; } // 관리자 프리뷰 테스트 — 순위표·퍼널 모두 제외
      refMap[label] = (refMap[label] ?? 0) + 1;
      if (!log.via_deeplink) orgView++;
    }
    const referrers = Object.entries(refMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // "메인 진입"은 오직 메인페이지 최초 진입만 집계(탐색형이므로 딥링크 진입도 제외) — 다른 탭 이동은 여기 포함하지 않음.
    const exploreFunnel = [
      { label: "메인 진입", count: orgView,     pct: 100 },
      { label: "기사 클릭", count: orgDetail,   pct: pct(orgDetail, orgView) },
      { label: "원문 클릭", count: orgOutbound, pct: pct(orgOutbound, orgView) },
    ];
    const deeplinkFunnel = [
      { label: "딥링크 진입", count: dlView,     pct: 100 },
      { label: "기사 열람",   count: dlDetail,   pct: pct(dlDetail, dlView) },
      { label: "원문 클릭",   count: dlOutbound, pct: pct(dlOutbound, dlView) },
    ];

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

    // ── 뉴스레터 지난호 (목록 조회 + Vol별 조회 랭킹) ──
    // utm_source는 이메일 "지난호 보기" 링크에만 붙어있음(withUTM) — 있으면 이메일 유입, 없으면 사이트 내(Footer 등) 유입
    const newsletterLogs = (newsletterArchiveLogs ?? []) as { newsletter_vol: number | null; utm_source: string | null }[];
    const newsletterListLogs = newsletterLogs.filter((l) => l.newsletter_vol == null);
    const newsletterListViews = newsletterListLogs.length;
    const newsletterListViewsFromEmail = newsletterListLogs.filter((l) => !!l.utm_source).length;
    const volMap: Record<number, number> = {};
    for (const l of newsletterLogs) {
      if (l.newsletter_vol == null) continue;
      volMap[l.newsletter_vol] = (volMap[l.newsletter_vol] ?? 0) + 1;
    }
    const topNewsletterIssues = Object.entries(volMap)
      .map(([vol, count]) => ({ vol: Number(vol), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totals: { view: viewCount, detail_view: detailCount, outbound_click: outboundCount, event_click: eventClickTotal },
      exploreFunnel,
      deeplinkFunnel,
      referrers,
      previewCount,
      utmCampaigns: utmCampaigns.length ? utmCampaigns : [],
      categories,
      topArticles,
      topSearches,
      newsletterListViews,
      newsletterListViewsFromEmail,
      topNewsletterIssues,
      topEvents,
      avgReadSec,
    };
  } catch {
    return EMPTY;
  }
}

function StatCard({ label, value, sub, info }: { label: string; value: string | number; sub?: string; info?: React.ReactNode }) {
  return (
    <div className="p-5 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-[0.7rem] font-semibold tracking-[0.05em] uppercase m-0"
          style={{ color: "var(--on-surface-variant)" }}>{label}</p>
        {info && <SectionInfoModal title={`${label}란?`}>{info}</SectionInfoModal>}
      </div>
      <p className="text-3xl font-bold tracking-tight m-0 break-words">{value.toLocaleString()}</p>
      {sub && <p className="text-xs mt-1 m-0" style={{ color: "var(--on-surface-variant)" }}>{sub}</p>}
    </div>
  );
}

type FunnelStep = { label: string; count: number; pct: number };

function FunnelBlock({ title, steps }: { title: string; steps: FunnelStep[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.68rem] font-semibold tracking-[0.05em] uppercase m-0" style={{ color: "var(--on-surface-variant)" }}>
        {title}
      </p>
      {steps.map((step, idx) => (
        <div key={step.label} className="flex items-center gap-4">
          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[0.65rem] font-bold"
            style={{ background: "var(--primary)", color: "#fff" }}>
            {idx + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-sm font-medium truncate">{step.label}</span>
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

// 기간 미지정 시 기본값 — 이번 주(월요일~오늘, KST 기준)
function defaultWeekRange(): { from: string; to: string } {
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = nowKST.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(nowKST);
  mon.setUTCDate(nowKST.getUTCDate() - diff);
  return { from: mon.toISOString().split("T")[0], to: nowKST.toISOString().split("T")[0] };
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; range?: string }> }) {
  const { from, to, range } = await searchParams;
  const isAll = range === "all";
  const hasRange = Boolean(from || to);
  const defaultRange = defaultWeekRange();
  const effectiveFrom = isAll ? null : hasRange ? (from ?? null) : defaultRange.from;
  const effectiveTo   = isAll ? null : hasRange ? (to ?? null)   : defaultRange.to;
  const [data, navCategories] = await Promise.all([fetchAnalytics(effectiveFrom, effectiveTo), fetchNavCategories()]);
  const { totals, exploreFunnel, deeplinkFunnel, referrers, previewCount, utmCampaigns, topArticles, topSearches, topEvents, avgReadSec, newsletterListViews, newsletterListViewsFromEmail, topNewsletterIssues } = data;

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
    <HelpProvider>
    <div className="p-8 max-w-5xl flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold tracking-tight m-0 flex items-center gap-2">애널리틱스 <HelpTriggerConnected /></h2>
          <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
            사용자 여정 · 유입 경로 · 카테고리 성과
          </p>
        </div>
        <DateRangePicker />
      </div>

      {/* ── 지표 용어 정리 — "접속/진입" 계열 용어가 여러 섹션에 흩어져 있어 한눈에 비교할 수 있게 정리 ── */}
      <details className="rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold" style={{ color: "var(--on-surface)" }}>
          📖 지표 용어 정리 — &ldquo;접속/진입&rdquo;이 여러 번 나오는 이유
        </summary>
        <div className="px-5 pb-5" style={{ fontSize: 13, lineHeight: 1.7, color: "var(--on-surface-variant)" }}>
          <p className="m-0 mb-3">숫자가 큰 것부터 작은 것 순서로 — 아래로 갈수록 위 항목의 부분집합입니다.</p>
          <ul className="m-0 pl-5" style={{ listStyle: "disc" }}>
            <li className="mb-2"><b style={{ color: "var(--on-surface)" }}>전체 페이지뷰</b> — 뉴스룸의 모든 페이지뷰 합계. 홈 진입 + 카테고리 아카이브 이동 + 행사 캘린더 진입 + 뉴스레터 딥링크 진입을 전부 포함하는 가장 큰 숫자.</li>
            <li className="mb-2">
              <b style={{ color: "var(--on-surface)" }}>EZ 뉴스룸 접속 경로 (총합)</b> — 전체 페이지뷰 중 <b>메인 진입 + 딥링크 진입</b>만 유입경로별로 나눈 것(카테고리 아카이브·행사 캘린더 이동은 여기서 빠짐).
              <ul className="m-0 mt-1 pl-5" style={{ listStyle: "circle" }}>
                <li><b style={{ color: "var(--on-surface)" }}>직접 접속</b> — 이 목록의 항목 중 하나. 리퍼러·UTM 정보가 전혀 없는 진입(주소창 직접 입력, 북마크 등)만 골라낸 값 — 목록 전체 합계와는 다름.</li>
              </ul>
            </li>
            <li className="mb-2"><b style={{ color: "var(--on-surface)" }}>메인 진입</b> — 인게이지먼트 퍼널 · 탐색형 1단계. 딥링크가 아닌, 메인(홈)페이지에 직접 들어온 것만.</li>
            <li className="mb-2"><b style={{ color: "var(--on-surface)" }}>딥링크 진입</b> — 인게이지먼트 퍼널 · 딥링크 1단계. 뉴스레터 등 링크 클릭으로 도착 즉시 모달이 자동으로 열린 진입.</li>
            <li><b style={{ color: "var(--on-surface)" }}>아카이브 방문</b> — 카테고리 탭(MICE·TOURISM·AI·EZPMP)을 눌러 아카이브 페이지로 이동한 횟수. 전체 페이지뷰에는 포함되지만 위 &ldquo;메인 진입&rdquo;·&ldquo;접속 경로&rdquo;에는 포함되지 않음.</li>
          </ul>
          <p className="m-0 mt-3" style={{ opacity: 0.8 }}>
            ※ &ldquo;기사 클릭&rdquo;·&ldquo;원문 클릭&rdquo;도 두 곳에 나오는데 <b>숫자 자체가 다릅니다</b> — 위 KPI 카드는 <b>탐색형 + 딥링크를 합친 전체 수치</b>이고, 인게이지먼트 퍼널의 &ldquo;탐색형&rdquo; 쪽은 딥링크를 뺀 수치라 항상 KPI 카드보다 작습니다.
            (예: KPI 기사 클릭 = 탐색형 기사 클릭 + 딥링크 퍼널의 기사 열람). 전환율(%) 역시 KPI는 전체 페이지뷰 기준, 퍼널은 메인 진입/딥링크 진입 기준이라 서로 다릅니다.
          </p>
        </div>
      </details>

      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="전체 페이지뷰" value={totals.view} info={
          <>
            <p className="m-0 mb-2">뉴스룸에서 발생한 모든 페이지뷰(view)의 합계입니다 — 홈 화면 진입, 카테고리 아카이브 이동, 행사 캘린더 진입, 뉴스레터 딥링크 진입을 모두 포함합니다.</p>
            <p className="m-0 mb-2" style={{ opacity: 0.75 }}>
              같은 사람이 여러 페이지를 넘나들면 그만큼 여러 번 집계됩니다(순 방문자 수가 아닌 방문 건수). 관리자 프리뷰 배포 테스트 접속도 포함된 수치입니다.
            </p>
            <p className="m-0" style={{ opacity: 0.75 }}>
              아래 &ldquo;메인 진입&rdquo;(인게이지먼트 퍼널)과는 다른 지표입니다 — 메인 진입은 딥링크를 제외한 메인페이지 진입만 세므로, 이 페이지뷰 총합보다 항상 작거나 같습니다.
            </p>
          </>
        } />
        <StatCard label="기사 클릭" value={totals.detail_view} sub={`전환율 ${detailRate}%`} />
        <StatCard label="원문 클릭" value={totals.outbound_click} sub={`전환율 ${outboundRate}%`} />
        <StatCard label="행사 클릭" value={totals.event_click} sub="EZPMP 픽 캘린더" />
        <StatCard label="평균 체류시간(2026-07-21부터 수집)" value={`${avgReadSec}초`} sub="홈 화면 전체 체류" />
        <StatCard label="전체 전환율" value={`${outboundRate}%`} sub="전체 페이지뷰 → 원문 클릭" />
      </div>

      {/* ── 유입 경로 + UTM 캠페인 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* 유입 경로 */}
        <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
              style={{ color: "var(--on-surface-variant)" }}>EZ 뉴스룸 접속 경로</p>
            <SectionInfoModal title="접속 경로 총합, 왜 메인 진입과 다른가요?">
              <p className="m-0 mb-2">
                이 목록의 합계 = <b>메인 진입(탐색형)</b> + <b>딥링크 진입</b>(인게이지먼트 퍼널 참고). 딥링크(뉴스레터 클릭 등 자동 오픈)로 들어온 방문까지 여기서는 &ldquo;뉴스레터 클릭 유입&rdquo; 등으로 같이 집계되기 때문에, 딥링크를 제외한 &ldquo;메인 진입&rdquo; 숫자보다 이 목록의 합계가 더 큽니다.
              </p>
              <p className="m-0" style={{ opacity: 0.75 }}>
                &ldquo;직접 접속&rdquo;은 이 목록의 여러 항목 중 하나일 뿐입니다 — 리퍼러(어디서 왔는지)·UTM 정보가 전혀 없는 진입(주소창 직접 입력, 북마크, 즐겨찾기 앱 링크 등)만 골라낸 값이라, 검색·SNS·다른 사이트 링크로 들어온 방문은 여기 포함되지 않고 각자 다른 항목으로 잡힙니다.
              </p>
            </SectionInfoModal>
          </div>
          {referrers.length === 0 && (
            <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
              유입 데이터가 없습니다.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {referrers.map((r) => (
              <div key={r.source} className="min-w-0">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-sm truncate">
                    {r.source}
                    {r.source === "봇/크롤러(자동수집)" && (
                      <span className="text-xs ml-1.5" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
                        (사람 아님 · 카톡 미리보기·모니터링 등)
                      </span>
                    )}
                    {r.source === "직접 접속" && (
                      <span className="text-xs ml-1.5" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
                        * 리퍼러·UTM 정보 없는 진입(주소창 직접 입력·북마크 등)
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold flex-shrink-0">{r.count.toLocaleString()}</span>
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
          {previewCount > 0 && (
            <p className="text-[0.68rem] mt-4 pt-3 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6, borderTop: "1px solid var(--surface-container-highest)" }}>
              ※ 관리자 프리뷰 배포 테스트 접속 {previewCount.toLocaleString()}건은 실사용자 유입이 아니라 위 순위에서 제외함
            </p>
          )}
        </section>

        {/* UTM 캠페인 */}
        <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-1 m-0"
            style={{ color: "var(--on-surface-variant)" }}>UTM 캠페인(뉴스레터 클릭 유입 호차별 상세)</p>
          <p className="text-[0.68rem] mb-5 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
            뉴스레터 클릭 후 뉴스기사 모달 진입
          </p>
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

      {/* ── 인게이지먼트 퍼널 (탐색형 vs 딥링크 분리) ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <div className="flex items-center gap-2 mb-5">
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0"
            style={{ color: "var(--on-surface-variant)" }}>
            인게이지먼트 퍼널
          </p>
          <SectionInfoModal title="인게이지먼트 퍼널이란?">
            <p className="m-0 mb-3">
              방문자가 접속 → 기사 클릭 → 원문 클릭까지 얼마나 이어지는지 보여주는 단계별 전환 지표입니다.
            </p>
            <p className="m-0 mb-1">
              딥링크(뉴스레터 개별 기사 클릭 등)는 도착 즉시 모달이 자동으로 열려 &ldquo;기사 클릭&rdquo;이 항상 100%에 가까움. 그래서 실제로 홈에서 직접 기사를 골라 클릭한 &ldquo;탐색형&rdquo; 여정과 분리하여 집계
            </p>
            <p className="m-0 mb-3" style={{ paddingLeft: 14 }}>
              → 뉴스레터를 통해 자동으로 열린 것과 진짜 클릭한 것이 섞여서 전환율이 왜곡 가능성 有
            </p>
            <p className="m-0 mb-1">
              ※ 탐색형은 &ldquo;뉴스레터가 아닌 유입&rdquo;이라는 뜻이 아님. 홈으로 들어와서 직접 기사를 고른 사람들 전체를 뜻하고 뉴스레터의 EZ 뉴스룸 바로가기처럼 홈으로 연결되는 링크도 여기 포함
            </p>
            <p className="m-0" style={{ paddingLeft: 14 }}>
              → 뉴스레터를 통한 개별 기사 딥링크(모달 자동 오픈)만 따로 지표 수집
            </p>
          </SectionInfoModal>
        </div>
        <div className={deeplinkFunnel[0].count > 0 ? "grid grid-cols-1 sm:grid-cols-2 gap-8" : ""}>
          <FunnelBlock title="탐색형 (직접 클릭)" steps={exploreFunnel} />
          {deeplinkFunnel[0].count > 0 && <FunnelBlock title="딥링크 (자동 오픈)" steps={deeplinkFunnel} />}
        </div>
      </section>

      {/* ── 카테고리별 성과 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-1 m-0"
          style={{ color: "var(--on-surface-variant)" }}>아카이브 카테고리별 기사 반응</p>
        <p className="text-[0.68rem] mb-5 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
          아카이브 방문 = 상단 카테고리를 눌러 아카이브 페이지를 연 횟수 · 기사·원문 클릭은 경로(홈·아카이브) 무관 합산
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                {["카테고리", "아카이브 방문", "기사 클릭", "원문 클릭", "평균 체류(초)"].map((h) => (
                  <th key={h} className="text-left pb-3 pr-4 text-[0.7rem] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--on-surface-variant)" }}>
                    {h}
                    {h === "평균 체류(초)" && (
                      <span className="block normal-case font-normal" style={{ fontSize: 10, opacity: 0.6, letterSpacing: 0 }}>
                        2026-05-28부터 수집
                      </span>
                    )}
                  </th>
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
                    <td className="py-3 pr-4">{cat.page_views.toLocaleString()}</td>
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

      {/* ── 뉴스레터 지난호 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-1 m-0"
          style={{ color: "var(--on-surface-variant)" }}>
          뉴스레터 지난호
          <span className="normal-case font-normal ml-1.5" style={{ fontSize: 10, opacity: 0.6, letterSpacing: 0 }}>
            (2026-07-30부터 수집)
          </span>
        </p>
        <p className="text-[0.68rem] mb-5 m-0" style={{ color: "var(--on-surface-variant)", opacity: 0.6 }}>
          목록 조회수 = 뉴스룸 푸터의 지난호 보기 방문 · Vol별 조회수 = 개별 호 상세 열람
        </p>
        <div className="flex items-center gap-8 mb-5">
          <div>
            <p className="text-[0.68rem] m-0 mb-0.5" style={{ color: "var(--on-surface-variant)" }}>지난호 목록 조회수</p>
            <p className="text-2xl font-bold m-0">{newsletterListViews.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[0.68rem] m-0 mb-0.5" style={{ color: "var(--on-surface-variant)" }}>그 중 이메일 유입</p>
            <p className="text-2xl font-bold m-0">
              {newsletterListViewsFromEmail.toLocaleString()}
              <span className="text-sm font-normal ml-1" style={{ color: "var(--on-surface-variant)" }}>
                ({newsletterListViews ? Math.round((newsletterListViewsFromEmail / newsletterListViews) * 100) : 0}%)
              </span>
            </p>
          </div>
        </div>
        {topNewsletterIssues.length === 0 ? (
          <p className="text-sm text-center py-6 m-0" style={{ color: "var(--on-surface-variant)" }}>
            아직 지난호 상세 조회 데이터가 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {topNewsletterIssues.map((iss, idx) => (
              <div key={iss.vol} className="flex items-center justify-between py-2"
                style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                <span className="text-sm font-medium">
                  <span className="text-[0.65rem] font-bold mr-2" style={{ color: "var(--on-surface-variant)" }}>#{idx + 1}</span>
                  Vol.{iss.vol}
                </span>
                <span className="text-sm font-semibold">{iss.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
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

      <HelpPanelConnected title="애널리틱스 가이드">
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--on-surface-variant)" }}>
          뉴스룸 독자의 행동 데이터를 자동 수집·분석합니다. 별도 설정 없이 방문자 발생 시 즉시 기록됩니다.
        </p>

        <Section title="1. KPI 카드">
          <Def term="전체 페이지뷰">
            뉴스룸에서 발생한 모든 페이지뷰의 합계입니다 — 홈 화면 진입, 카테고리 아카이브 이동, 행사 캘린더 진입,
            뉴스레터 딥링크 진입을 모두 포함합니다(새로고침·재방문 포함). 아래 &quot;3. 인게이지먼트 퍼널&quot;의
            &quot;메인 진입&quot;과는 다른 지표입니다 — 메인 진입은 딥링크를 제외한 메인페이지 진입만 세므로 항상 이 값보다 작거나 같습니다.
          </Def>
          <Def term="기사 클릭">기사 카드를 눌러 요약·인사이트 모달을 열람한 횟수입니다. 전환율 = 기사 클릭 ÷ 전체 페이지뷰.</Def>
          <Def term="원문 클릭">모달 내 &quot;VIEW ORIGINAL SOURCE&quot; 클릭 횟수입니다. 전환율 = 원문 클릭 ÷ 전체 페이지뷰.</Def>
          <Def term="전체 전환율">전체 페이지뷰 대비 원문 클릭 비율입니다(전체 페이지뷰 → 원문 클릭).</Def>
        </Section>

        <Section title="2. 트래픽 소스">
          <Item text="UTM 파라미터가 있으면 우선 사용합니다(카카오톡, 뉴스레터, SNS 등)." />
          <Item text="UTM이 없으면 브라우저가 보내는 referrer(어디서 왔는지) 도메인으로 자동 판별합니다 — 사내 AIGate처럼 링크에 UTM을 못 붙이는 경로도 잡힘." />
          <Indent>링크 예시: ?utm_source=kakao&amp;utm_campaign=weekly</Indent>
          <Def term="&quot;OO 클릭 유입&quot;의 의미">
            각 라벨은 그 방문이 해당 링크를 직접 클릭해 들어왔다는 뜻(last-touch)입니다. 같은 사람이 나중에
            북마크·주소입력으로 재방문하면 &apos;직접 접속&apos;으로 잡히므로, &quot;뉴스레터가 끌어온 누적 트래픽&quot;이 아니라
            &quot;이번 방문의 직접 유입원&quot;으로 해석해야 정확합니다.
          </Def>
          <Def term="봇/크롤러(자동수집)">
            실제 사람이 아니라 시스템이 자동으로 페이지를 렌더링한 접속입니다. 사람 트래픽과 구분해 표시하지만
            전체 페이지뷰 집계에서 제외되진 않습니다.
          </Def>
          <Indent>
            카카오톡·슬랙·카카오뷰 등에 링크를 공유하면 메신저 서버가 미리보기용으로 한 번 접속(링크 미리보기 봇) ·
            사이트가 살아있는지 주기적으로 확인하는 모니터링/업타임 체크 봇 · Playwright·Puppeteer 등 SEO 크롤러·자동화 테스트 툴
          </Indent>
        </Section>

        <Section title="3. 인게이지먼트 퍼널">
          <Item text="탐색형/딥링크 여정 구분 및 상세 설명은 해당 섹션 제목 옆 ⓘ 아이콘을 참고하세요." />
        </Section>

        <Section title="4. 아카이브 카테고리별 기사 반응">
          <Def term="아카이브 방문">상단 카테고리(MICE·TOURISM·AI·EZPMP)를 눌러 아카이브 페이지(/category/AI 등)를 연 횟수입니다.</Def>
          <Def term="기사 클릭">해당 카테고리 기사를 클릭해 모달을 열람한 횟수입니다(홈 피드·아카이브 등 경로 무관 합산).</Def>
          <Def term="원문 클릭">해당 카테고리 기사에서 원문으로 이동한 횟수입니다.</Def>
        </Section>

        <Section title="5. 뉴스레터 지난호">
          <Def term="지난호 목록 조회수">
            뉴스룸 푸터의 &quot;지난호 보기&quot; 방문 횟수입니다. &quot;그 중 이메일 유입&quot;은 뉴스레터 본문 링크(UTM 포함)로
            들어온 것만 구분하며, 나머지는 사이트 Footer 등에서 직접 들어온 것입니다.
          </Def>
          <Def term="Vol별 조회수">
            목록에서 개별 호 카드를 클릭해 그 호의 실제 발송본(HTML)을 열람한 횟수입니다. 어떤 지난호가 인기 있는지
            확인할 수 있습니다.
          </Def>
          <Item text="2026-07-30부터 수집 시작 — 그 이전 시점 데이터는 없습니다." />
        </Section>

        <Section title="6. 인기 검색어">
          <Item text="뉴스룸 상단 검색창에서 실행된 검색어를 빈도순으로 집계합니다." />
          <Item text="독자가 관심 갖는 키워드 파악 및 콘텐츠 기획에 활용하세요." />
        </Section>

        <Section title="7. 행사 클릭 · 평균 체류시간">
          <Def term="행사 클릭">
            홈·행사 캘린더의 EZPMP 픽 카드를 클릭한 횟수입니다. 인기 행사 TOP 5로 어떤 픽이 실제 반응이 좋은지 확인할 수 있습니다.
          </Def>
          <Def term="평균 체류시간">
            홈 화면에 진입한 순간부터 이탈(탭 닫기·다른 사이트 이동·다른 페이지 이동)할 때까지의 전체 체류 시간(초)입니다.
            탭이 백그라운드에 있는 동안은 카운트에서 제외됩니다. 2026-07-21부터 수집.
          </Def>
          <Item text="카테고리별 성과 표의 '평균 체류(초)'는 이것과 다릅니다 — 해당 카테고리 기사의 인사이트 모달을 열어본 평균 시간만 별도로 집계(2026-05-28부터 수집)." />
          <div style={{ marginTop: 6 }}>
            <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 700, color: "var(--on-surface)" }}>어떻게 측정하나</p>
            <Indent>
              홈 화면 진입 시점에 타이머 시작, 탭이 백그라운드로 전환되면(Page Visibility API) 자동으로 일시정지되어
              딴 짓하는 시간은 제외됩니다. 탭을 닫거나 다른 사이트로 이동하면(pagehide) navigator.sendBeacon()으로
              마지막 순간까지 반영해 전송하므로 페이지가 사라져도 유실 없이 도착합니다. 사이트 내 다른 화면으로
              이동해도 벗어나는 순간 지금까지 누적된 시간을 기록하며, 자리비움 등 이상치 방지를 위해 최대 30분까지만 인정합니다.
            </Indent>
          </div>
        </Section>
      </HelpPanelConnected>
    </div>
    </HelpProvider>
  );
}
