import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* ── 빈 데이터 기본값 ── */
const EMPTY = {
  totals: { view: 0, detail_view: 0, outbound_click: 0 },
  funnel: [
    { label: "메인 노출",    count: 0, pct: 100 },
    { label: "인사이트 열람", count: 0, pct: 0 },
    { label: "원문 클릭",    count: 0, pct: 0 },
  ],
  referrers:    [] as { source: string; count: number }[],
  utmCampaigns: [] as { campaign: string; count: number }[],
  categories:   [] as { category: string; views: number; detail_views: number; outbound: number; avg_read_sec: number }[],
  topArticles:  [] as { title: string; category: string; detail_views: number; outbound: number }[],
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

async function fetchAnalytics() {
  try {
    const supabase      = await createClient();
    const adminSupabase = createAdminClient();

    const [{ data: logs }, { data: articles }] = await Promise.all([
      supabase.from("user_logs").select("event_type, news_id, utm_source, utm_campaign"),
      adminSupabase.from("news").select("id, title, category"),
    ]);

    if (!logs?.length) return EMPTY;

    // ── 기본 카운트 ──
    const view        = logs.filter((r) => r.event_type === "view").length;
    const detail_view = logs.filter((r) => r.event_type === "detail_view").length;
    const outbound    = logs.filter((r) => r.event_type === "outbound_click").length;

    // ── 유입 경로 (utm_source 기반) ──
    const refMap: Record<string, number> = {};
    for (const log of logs) {
      const raw   = (log.utm_source ?? "").toLowerCase();
      const label = SOURCE_LABEL[raw] ?? "직접 접속";
      refMap[label] = (refMap[label] ?? 0) + 1;
    }
    const referrers = Object.entries(refMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // ── UTM 캠페인 ──
    const campMap: Record<string, number> = {};
    for (const log of logs) {
      const camp = log.utm_campaign ?? "(없음)";
      campMap[camp] = (campMap[camp] ?? 0) + 1;
    }
    const utmCampaigns = Object.entries(campMap)
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ── 카테고리별 성과 ──
    const articleMap  = new Map((articles ?? []).map((a) => [a.id, a]));
    const catViews:   Record<string, number> = {};
    const catDetails: Record<string, number> = {};
    const catOut:     Record<string, number> = {};

    for (const log of logs) {
      if (!log.news_id) continue;
      const art = articleMap.get(log.news_id);
      if (!art) continue;
      const c = art.category;
      if (log.event_type === "view")           catViews[c]   = (catViews[c]   ?? 0) + 1;
      if (log.event_type === "detail_view")    catDetails[c] = (catDetails[c] ?? 0) + 1;
      if (log.event_type === "outbound_click") catOut[c]     = (catOut[c]     ?? 0) + 1;
    }

    const allCats  = new Set([...Object.keys(catViews), ...Object.keys(catDetails)]);
    const categories = Array.from(allCats).map((cat) => ({
      category:     cat,
      views:        catViews[cat]   ?? 0,
      detail_views: catDetails[cat] ?? 0,
      outbound:     catOut[cat]     ?? 0,
      avg_read_sec: 0,
    })).sort((a, b) => b.detail_views - a.detail_views);

    // ── 인기 기사 TOP 5 ──
    const artDetails: Record<string, number> = {};
    const artOut:     Record<string, number> = {};
    for (const log of logs) {
      if (!log.news_id) continue;
      if (log.event_type === "detail_view")    artDetails[log.news_id] = (artDetails[log.news_id] ?? 0) + 1;
      if (log.event_type === "outbound_click") artOut[log.news_id]     = (artOut[log.news_id]     ?? 0) + 1;
    }
    const topArticles = Object.entries(artDetails)
      .map(([id, detail_views]) => {
        const art = articleMap.get(id);
        return { title: art?.title ?? "(삭제된 기사)", category: art?.category ?? "-", detail_views, outbound: artOut[id] ?? 0 };
      })
      .sort((a, b) => b.detail_views - a.detail_views)
      .slice(0, 5);

    return {
      totals: { view, detail_view, outbound_click: outbound },
      funnel: [
        { label: "메인 노출",    count: view,        pct: 100 },
        { label: "인사이트 열람", count: detail_view, pct: view ? +((detail_view / view) * 100).toFixed(1) : 0 },
        { label: "원문 클릭",    count: outbound,    pct: view ? +((outbound    / view) * 100).toFixed(1) : 0 },
      ],
      referrers:    referrers.length    ? referrers    : [{ source: "직접 접속", count: logs.length }],
      utmCampaigns: utmCampaigns.length ? utmCampaigns : [{ campaign: "(없음)", count: logs.length }],
      categories,
      topArticles,
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

export default async function AnalyticsPage() {
  const [data, navCategories] = await Promise.all([fetchAnalytics(), fetchNavCategories()]);
  const { totals, funnel, referrers, utmCampaigns, topArticles } = data;
  // 카테고리 성과: DB nav_categories 기준으로 필터
  const categories = data.categories.filter((c) =>
    navCategories.includes(c.category)
  );

  const detailRate  = totals.view ? ((totals.detail_view / totals.view) * 100).toFixed(1) : "0";
  const outboundRate = totals.view ? ((totals.outbound_click / totals.view) * 100).toFixed(1) : "0";
  const maxRef      = Math.max(...referrers.map((r) => r.count));
  const maxCat      = Math.max(...categories.map((c) => c.detail_views));

  return (
    <div className="p-8 max-w-5xl flex flex-col gap-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight m-0">애널리틱스</h2>
        <p className="text-sm m-0 mt-0.5" style={{ color: "var(--on-surface-variant)" }}>
          사용자 여정 · 유입 경로 · 카테고리 성과
        </p>
      </div>

      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="총 노출" value={totals.view} />
        <StatCard label="인사이트 열람" value={totals.detail_view} sub={`전환율 ${detailRate}%`} />
        <StatCard label="원문 클릭" value={totals.outbound_click} sub={`전환율 ${outboundRate}%`} />
        <StatCard
          label="전체 전환율"
          value={`${outboundRate}%`}
          sub="노출 → 원문 클릭"
        />
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

      {/* ── 카테고리 성과 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
          style={{ color: "var(--on-surface-variant)" }}>카테고리별 성과</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                {["카테고리", "노출", "열람", "열람 전환율", "원문 클릭", "평균 체류(초)", "관심도"].map((h) => (
                  <th key={h} className="text-left pb-3 pr-4 text-[0.7rem] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--on-surface-variant)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const convRate = cat.views ? ((cat.detail_views / cat.views) * 100).toFixed(1) : "0";
                return (
                  <tr key={cat.category} style={{ borderBottom: "1px solid var(--surface-container-highest)" }}>
                    <td className="py-3 pr-4 font-semibold">
                      <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold tracking-wide uppercase"
                        style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)" }}>
                        {cat.category}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{cat.views.toLocaleString()}</td>
                    <td className="py-3 pr-4">{cat.detail_views.toLocaleString()}</td>
                    <td className="py-3 pr-4">{convRate}%</td>
                    <td className="py-3 pr-4">{cat.outbound}</td>
                    <td className="py-3 pr-4">{cat.avg_read_sec}s</td>
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
          {categories.length === 0 && (
            <p className="text-sm text-center py-8 m-0" style={{ color: "var(--on-surface-variant)" }}>
              아직 카테고리 데이터가 없습니다.
            </p>
          )}
        </div>
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
                  <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>열람</p>
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
    </div>
  );
}
