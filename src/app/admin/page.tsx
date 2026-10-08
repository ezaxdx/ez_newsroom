import { createAdminClient } from "@/lib/supabase/admin";
import { NewsItem } from "@/lib/types";
import { NEWS_CARD_COLUMNS, toCardItem } from "@/lib/admin-news";
import { calcLastScheduledRun } from "@/lib/schedule";
import CurationBoard from "@/components/admin/CurationBoard";
import { HelpProvider, HelpPanelConnected, Section, Item, Def } from "@/components/admin/HelpPanel";

export const dynamic = "force-dynamic";


// 보드가 처음 읽는 기사: 메인 표시 중(직전 큐레이션 이후 발행분) + 대기열 전량. 아카이브는 탭을 열 때 "더 보기"로 나눠 읽는다.
// 카드에 보이는 컬럼만 읽고(본문·시사점은 편집 창을 열 때 한 건씩), PostgREST 의 1000행 제한은 페이지를 나눠 넘는다.
async function fetchBoardNews(lastRunISO: string): Promise<{ news: NewsItem[]; counts: { total: number; published: number; staging: number; archive: number } }> {
  const empty = { news: [] as NewsItem[], counts: { total: 0, published: 0, staging: 0, archive: 0 } };
  try {
    const supabase = createAdminClient();
    const PAGE = 1000;
    const readAll = async (build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as Record<string, unknown>[]));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    };
    const count = async (f: (q: ReturnType<ReturnType<typeof supabase.from>["select"]>) => unknown) => {
      const q = supabase.from("news").select("id", { count: "exact", head: true });
      const { count: c } = (await (f(q as never) as PromiseLike<{ count: number | null }>));
      return c ?? 0;
    };
    const [liveRows, stagingRows, total, published, archive] = await Promise.all([
      readAll((from, to) => supabase.from("news").select(NEWS_CARD_COLUMNS)
        .eq("is_published", true).gte("published_at", lastRunISO)
        .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      readAll((from, to) => supabase.from("news").select(NEWS_CARD_COLUMNS)
        .eq("is_published", false)
        .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      count((q) => q),
      count((q) => (q as unknown as { eq: (c: string, v: boolean) => unknown }).eq("is_published", true)),
      count((q) => (q as unknown as { eq: (c: string, v: boolean) => { lt: (c: string, v: string) => unknown } }).eq("is_published", true).lt("published_at", lastRunISO)),
    ]);
    return {
      news: [...liveRows, ...stagingRows].map(toCardItem),
      counts: { total, published, staging: total - published, archive },
    };
  } catch { return empty; }
}
async function fetchSettings(): Promise<{
  qualityThresholds: { auto_publish: number; staging: number };
  displayWindowDays: number;
  scheduleDays: number[];
  scheduleHour: number;
  scheduleEnabled: boolean;
  navCategories: string[];
}> {
  const defaults = { qualityThresholds: { auto_publish: 8, staging: 5 }, displayWindowDays: 4, scheduleDays: [2, 4], scheduleHour: 9, scheduleEnabled: true, navCategories: [] };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return defaults;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("quality_thresholds, auto_schedule, nav_categories")
      .limit(1)
      .single();
    const qualityThresholds = data?.quality_thresholds ?? { auto_publish: 8, staging: 5 };
    const schedule = data?.auto_schedule ?? { enabled: false, days: [] };
    const scheduleDays: number[] = schedule.days ?? [];
    const scheduleHour: number = schedule.hour ?? 9;
    const scheduleEnabled: boolean = schedule.enabled ?? false;
    // displayWindowDays: CurationBoard의 스케줄 없을 때 폴백용
    // 실제 live/archive 분류는 CurationBoard에서 calcLastScheduledRun 사용
    const displayWindowDays = 4;
    const navCategories: string[] = data?.nav_categories ?? [];
    return { qualityThresholds, displayWindowDays, scheduleDays, scheduleHour, scheduleEnabled, navCategories };
  } catch { return defaults; }
}

type CurationLog = {
  id: string;
  run_at: string;
  duration_ms: number;
  fetched: number;
  published: number;
  staged: number;
  skipped: number;
  failed: number;
  run_mode?: string;
  details?: { trigger?: string; status?: string } | null;
  errors: Array<{ source: string; url?: string; error: string }> | null;
  source_stats: Array<{ source_name: string; fetched: number; published: number; staged: number; failed: number }> | null;
};

async function fetchCurationLogs(): Promise<CurationLog[]> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_logs")
      .select("id, run_at, run_mode, details, duration_ms, fetched, published, staged, skipped, failed, errors, source_stats")
      .order("run_at", { ascending: false })
      .limit(10);
    return (data ?? []) as CurationLog[];
  } catch { return []; }
}

export default async function AdminPage() {
  // "메인 표시 중" 기준 시각은 설정(예약 요일·시각)에서 정해지므로 설정을 먼저 읽고, 그 시각으로 기사를 읽는다
  const settings = await fetchSettings();
  const { qualityThresholds, displayWindowDays, scheduleDays, scheduleHour, scheduleEnabled, navCategories } = settings;
  const lastRunISO = (scheduleEnabled && scheduleDays.length > 0
    ? calcLastScheduledRun(scheduleDays, scheduleHour)
    : new Date(Date.now() - displayWindowDays * 24 * 60 * 60 * 1000)).toISOString();
  const [{ news, counts }, curationLogs] = await Promise.all([fetchBoardNews(lastRunISO), fetchCurationLogs()]);

  return (
    <HelpProvider>
    <div className="p-8 max-w-4xl">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "전체 기사", value: counts.total },
          { label: "발행됨", value: counts.published },
          { label: "대기 중", value: counts.staging },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-5 rounded-lg"
            style={{ background: "var(--surface-container-lowest)" }}
          >
            <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-1"
              style={{ color: "var(--on-surface-variant)" }}>
              {label}
            </p>
            <p className="text-3xl font-bold tracking-tight m-0">{value}</p>
          </div>
        ))}
      </div>

      <CurationBoard initialNews={news} qualityThresholds={qualityThresholds} displayWindowDays={displayWindowDays} scheduleDays={scheduleDays} scheduleHour={scheduleHour} scheduleEnabled={scheduleEnabled} navCategories={navCategories} lastRunISO={lastRunISO} archiveTotal={counts.archive} />

      {/* 큐레이션 실행 로그 */}
      <div className="mt-8 mb-8">
        <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-3" style={{ color: "var(--on-surface-variant)" }}>
          큐레이션 실행 로그
        </p>
        {curationLogs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--on-surface-variant)" }}>아직 실행 기록이 없습니다.</p>
        ) : (
          <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--outline-variant)" }}>
            <table className="w-full text-sm" style={{ minWidth: 620 }}>
              <thead>
                <tr style={{ background: "var(--surface-container-lowest)" }}>
                  {["실행 시각", "구분", "가져옴", "발행", "대기", "스킵", "실패", "소요"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[0.68rem] font-semibold tracking-[0.05em] uppercase" style={{ color: "var(--on-surface-variant)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {curationLogs.map((log, i) => {
                  const kst = new Date(new Date(log.run_at).getTime() + 9 * 60 * 60 * 1000);
                  const dateStr = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}-${String(kst.getDate()).padStart(2, "0")} ${String(kst.getHours()).padStart(2, "0")}:${String(kst.getMinutes()).padStart(2, "0")}`;
                  const mins = Math.floor((log.duration_ms ?? 0) / 60000);
                  const secs = Math.floor(((log.duration_ms ?? 0) % 60000) / 1000);
                  const dur = mins > 0 ? `${mins}분 ${secs}초` : `${secs}초`;
                  return (
                    <tr key={log.id} style={{ borderTop: i > 0 ? "1px solid var(--outline-variant)" : undefined }}>
                      <td className="px-3 py-2 font-mono" style={{ color: "var(--on-surface-variant)" }}>{dateStr}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {(() => {
                          const trig = log.run_mode === "dry" ? "시험" : log.details?.trigger === "manual" ? "수동" : log.details?.trigger === "cron" ? "자동" : "기록 없음";
                          const status = log.details?.status;
                          const stale = status === "running" && Date.now() - new Date(log.run_at).getTime() > 10 * 60 * 1000;
                          return (
                            <>
                              <span className="font-semibold">{trig}</span>
                              {status === "running" && !stale && <span style={{ color: "var(--primary)" }}> · 실행 중</span>}
                              {(status === "failed" || stale) && <span style={{ color: "var(--error)" }}> · 중단됨</span>}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">{log.fetched ?? "-"}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: log.published > 0 ? "var(--primary)" : undefined }}>{log.published ?? "-"}</td>
                      <td className="px-3 py-2">{log.staged ?? "-"}</td>
                      <td className="px-3 py-2">{log.skipped ?? "-"}</td>
                      <td className="px-3 py-2" style={{ color: (log.failed ?? 0) > 0 ? "var(--error)" : undefined }}>
                        {(log.failed ?? 0) > 0 && log.errors && log.errors.length > 0 ? (
                          <details>
                            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--error)" }}>
                              {log.failed}
                            </summary>
                            <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 4, background: "var(--surface-container-low)", fontSize: "0.68rem", lineHeight: 1.6, minWidth: 200 }}>
                              {log.errors.map((e, i) => (
                                <div key={i} style={{ marginBottom: i < log.errors!.length - 1 ? 4 : 0 }}>
                                  <span style={{ fontWeight: 600 }}>{e.source}</span>
                                  {e.url && <span style={{ color: "var(--on-surface-variant)", marginLeft: 4, wordBreak: "break-all" }}>{e.url}</span>}
                                  <div style={{ color: "var(--error)" }}>{e.error}</div>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : (log.failed ?? "-")}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--on-surface-variant)" }}>{dur}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HelpPanelConnected title="큐레이션 보드 가이드">
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--on-surface-variant)" }}>
          뉴스룸의 핵심 운영 화면입니다. 수집된 기사 전체를 확인하고 발행·반려를 직접 처리합니다.
        </p>

        <Section n={1} title="주요 기능">
          <Item text="전체·발행됨·대기 중 기사 수 통계를 확인합니다." />
          <Item text="기사별 품질 점수(1~10), 카테고리, 레벨을 확인합니다. 카테고리·레벨 배지를 누르면 기사 편집 창이 열려 한 곳에서 고칠 수 있습니다(레벨은 값만 바뀌고 글은 다시 쓰이지 않습니다)." />
          <Item text="대기 중 기사를 수동으로 발행하거나 삭제합니다." />
          <Def term="큐레이션 즉시 실행">스케줄 외에 수동으로 실행할 수 있습니다.</Def>
        </Section>

        <Section n={2} title="자동 발행·대기·폐기 기준">
          <Item text="품질 점수 8점 이상이면서 적합성 7점 이상 → 자동 발행 (품질 기준 점수는 큐레이션 설정에서 조정, 기본 8점)" />
          <Item text="품질 점수 5점 이상이지만 위 조건에 못 미침 → 대기 (수동 검토 후 발행)" />
          <Item text="품질 점수 5점 미만, 또는 적합성 4점 이하 → 자동 폐기" />
          <Item text="발행일을 확인하지 못한 기사, 최근 기사와 같은 사건으로 보이는 기사(중복 의심), 한 번에 자동 발행할 수 있는 20건을 넘은 기사는 점수가 높아도 대기로 갑니다." />
          <Item text="이즈픽 행사 기사와 EZPMP 자사 기사는 적합성 기준과 20건 상한에서 제외됩니다." />
        </Section>

        <Section n={3} title="자동 실행 스케줄">
          <Item text="큐레이션 설정의 자동 스케줄(기본 화요일·목요일 오전 9시 KST)에 맞춰 자동 실행됩니다." />
          <Item text="수동 실행은 [큐레이션 실행] 버튼을 클릭하세요." />
        </Section>

        <Section n={4} title="탭 분류 기준">
          <Def term="메인 표시 중">가장 최근 큐레이션 실행 이후 발행된 기사입니다. 홈 페이지에 노출됩니다.</Def>
          <Def term="대기열">자동 발행 조건(품질·적합성·발행일 확인·중복 의심·20건 상한)을 통과하지 못해 보류 중인 기사입니다. 수동으로 발행·삭제할 수 있고, 생성 후 30일이 지나면 자동 삭제됩니다.</Def>
          <Def term="아카이브">이전 큐레이션 배치의 기사입니다. 홈에서 내려간 상태이며 카테고리 아카이브 페이지에 표시됩니다.</Def>
        </Section>

        <Section n={5} title="아카이브 기준">
          <Item text="기준 시각: 가장 최근 스케줄 실행일 오전 9시 KST(화·목 기준)" />
          <Item text="기준 시각 이전 발행 → 아카이브 / 이후 발행 → 메인 표시 중" />
          <Item text="예) 목요일 큐레이션 실행 후 → 목요일 오전 9시 이전 기사는 전부 아카이브로 이동" />
          <Item text="아카이브 기사는 [재발행] 버튼으로 오늘 날짜 기준 메인에 다시 올릴 수 있습니다." />
        </Section>
      </HelpPanelConnected>
    </div>
    </HelpProvider>
  );
}
