import { createClient } from "@/lib/supabase/server";

/* ── Mock data (Supabase 미연결 시 사용) ── */
const MOCK = {
  totals: { view: 1248, detail_view: 423, outbound_click: 87 },
  funnel: [
    { label: "메인 노출", count: 1248, pct: 100 },
    { label: "인사이트 열람", count: 423, pct: 33.9 },
    { label: "원문 클릭", count: 87, pct: 6.97 },
  ],
  referrers: [
    { source: "뉴스레터", count: 512 },
    { source: "직접 접속", count: 318 },
    { source: "LinkedIn", count: 204 },
    { source: "카카오톡", count: 147 },
    { source: "Twitter / X", count: 67 },
  ],
  utmCampaigns: [
    { campaign: "weekly_brief_0421", count: 412 },
    { campaign: "mice_special_0415", count: 198 },
    { campaign: "ai_digest_0410", count: 134 },
    { campaign: "(없음)", count: 504 },
  ],
  categories: [
    { category: "AI",         views: 418, detail_views: 162, outbound: 38, avg_read_sec: 94 },
    { category: "MICE",       views: 312, detail_views: 128, outbound: 24, avg_read_sec: 112 },
    { category: "TOURISM",    views: 287, detail_views: 89,  outbound: 17, avg_read_sec: 78 },
    { category: "STARTUP",    views: 148, detail_views: 32,  outbound: 6,  avg_read_sec: 65 },
    { category: "POLICY",     views: 83,  detail_views: 12,  outbound: 2,  avg_read_sec: 51 },
  ],
  topArticles: [
    { title: "서울 MICE 산업, 생성형 AI 도입으로 운영 비용 23% 절감", category: "MICE", detail_views: 89, outbound: 18 },
    { title: "호텔 체인, 다국어 컨시어지 챗봇 전국 도입",             category: "AI",   detail_views: 74, outbound: 15 },
    { title: "야간 관광 특화 콘텐츠로 체류시간 1.4배 증가",            category: "TOURISM", detail_views: 61, outbound: 11 },
    { title: "Global Trade Reach Numbers Hit as New Wave Goes Online",  category: "AI",   detail_views: 55, outbound: 9 },
    { title: "여행 스타트업 데이터 연합으로 추천 전환율 상승",          category: "STARTUP", detail_views: 43, outbound: 7 },
  ],
};

async function fetchAnalytics() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return MOCK;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("user_logs")
      .select("event_type, news_id, referrer, utm_source, utm_campaign");
    if (!data?.length) return MOCK;

    const view        = data.filter((r) => r.event_type === "view").length;
    const detail_view = data.filter((r) => r.event_type === "detail_view").length;
    const outbound    = data.filter((r) => r.event_type === "outbound_click").length;

    return {
      ...MOCK,
      totals: { view, detail_view, outbound_click: outbound },
      funnel: [
        { label: "메인 노출",    count: view,         pct: 100 },
        { label: "인사이트 열람", count: detail_view,  pct: view ? +((detail_view / view) * 100).toFixed(1) : 0 },
        { label: "원문 클릭",    count: outbound,      pct: view ? +((outbound / view) * 100).toFixed(1) : 0 },
      ],
    };
  } catch {
    return MOCK;
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

export default async function AnalyticsPage() {
  const data = await fetchAnalytics();
  const { totals, funnel, referrers, utmCampaigns, categories, topArticles } = data;

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
        </div>
      </section>

      {/* ── 인기 기사 ── */}
      <section className="p-6 rounded-lg" style={{ background: "var(--surface-container-lowest)" }}>
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-5 m-0"
          style={{ color: "var(--on-surface-variant)" }}>인기 기사 TOP 5</p>
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
