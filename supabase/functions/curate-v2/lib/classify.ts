// 발행 후 사업영역 판정 — 큐레이션(발행)을 기다리게 하지 않고, 영역이 비어 있고 아직 판정하지 않은 기사를 뒤에서 채움.
// 큐레이션 때 저장해 둔 원문(news_original_text)을 쓰므로 다시 읽지 않아도 됨 (없는 예전 기사만 원문 주소를 읽고, 그것도 안 되면 기사 요약 사용).
// 시간이 모자라면 남은 기사는 다음 실행에서 이어서 처리 (domains_judged_at 이 비어 있는 기사가 대상).
import { extractDomainSection, judgeDomains } from "./ai.ts";
import { resolveNaverBlogUrl } from "./fetchers.ts";
import { CHROME_UA, extractText, mapPool } from "./util.ts";
import { sendAlert } from "./alert.ts";

export interface ClassifyDeps {
  supabase: any;
  env: (key: string) => string | undefined;
  log?: (msg: string) => void;
}
export interface ClassifyOptions {
  dry?: boolean;          // true: 판정만 하고 저장하지 않음
  budgetMs?: number;      // 처리 시간 예산
  limit?: number;         // 1회 최대 건수
  maxAgeDays?: number;    // 이보다 오래된 기사는 대상에서 제외 (기본 60일)
}

export async function classifyPending(deps: ClassifyDeps, opts: ClassifyOptions = {}) {
  const { supabase, env } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const start = Date.now();
  const budgetMs = opts.budgetMs ?? 110_000;
  const apiKey = env("GOOGLE_AI_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY 없음");

  const { data: settings } = await supabase.from("curation_settings").select("company_context, business_domain_examples").limit(1).single();
  const definitions = extractDomainSection(settings?.company_context);   // 회사 소개 문서의 영역 정의·판단 기준을 그대로 사용
  const examples: { title: string; business_domains: string[] }[] = Array.isArray(settings?.business_domain_examples) ? settings.business_domain_examples : [];

  // 대상: 영역이 비어 있고(관리자가 이미 고친 기사는 태그가 있거나 판정 완료 표시가 있어 제외) 아직 판정하지 않은 기사, 최신순
  const since = new Date(Date.now() - (opts.maxAgeDays ?? 60) * 86400000).toISOString();
  const { data: targets, error } = await supabase.from("news")
    .select("id, title, summary_short, content_long, original_url")
    .is("domains_judged_at", null).eq("business_domains", "{}").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(opts.limit ?? 120);
  if (error) throw new Error(`대상 조회 실패: ${error.message}`);
  const list: { id: string; title: string; summary_short: string | null; content_long: string | null; original_url: string }[] = targets ?? [];
  if (!list.length) return { ok: true, processed: 0, classified: 0, empty: 0, failed: 0, remaining: 0, duration_ms: Date.now() - start };

  // 저장해 둔 원문
  const stored = new Map<string, string>();
  const { data: texts } = await supabase.from("news_original_text").select("news_id, original_text").in("news_id", list.map((n) => n.id));
  for (const t of texts ?? []) stored.set(t.news_id, t.original_text);

  const fetchText = async (url: string): Promise<string> => {
    try {
      const target = resolveNaverBlogUrl(url);
      const r = await fetch(target, { headers: { "User-Agent": CHROME_UA, ...(target !== url ? { Referer: "https://blog.naver.com/" } : {}) }, signal: AbortSignal.timeout(8000), redirect: "follow" });
      return r.ok ? extractText(await r.text()) : "";
    } catch { return ""; }
  };

  let classified = 0, empty = 0, failed = 0, done = 0, lastError = "";
  const sample: { title: string; domains: string[] }[] = [];
  await mapPool(list, 6, async (n) => {
    if (Date.now() - start > budgetMs) return;   // 시간 예산 초과 — 남은 기사는 다음 실행에서
    let text = stored.get(n.id) ?? "";
    if (text.length < 300) text = await fetchText(n.original_url);
    if (text.length < 300) text = `${n.summary_short ?? ""}\n${n.content_long ?? ""}`;   // 원문을 못 읽으면 기사 요약·본문으로
    const r = await judgeDomains({ apiKey, title: n.title, text, examples, definitions });
    if (!r.ok) { failed++; lastError = r.error; return; }          // 실패한 기사는 표시하지 않아 다음 실행에서 다시 시도
    done++;
    if (r.domains.length) classified++; else empty++;
    if (sample.length < 5) sample.push({ title: n.title.slice(0, 40), domains: r.domains });
    if (!opts.dry) {
      // 그 사이 관리자가 고친 기사(판정 완료 표시가 생김)는 덮어쓰지 않음
      await supabase.from("news").update({ business_domains: r.domains, domains_judged_at: new Date().toISOString() }).eq("id", n.id).is("domains_judged_at", null);
    }
  });

  const remaining = list.length - done - failed;
  log(`[영역 판정] ${done}건 완료 (영역 있음 ${classified} · 해당 없음 ${empty}), 실패 ${failed}, 남음 ${remaining} (${Date.now() - start}ms)`);
  // 전부 실패했다면 키·한도 같은 구조적 문제일 수 있어 알림 (일부 실패는 다음 실행에서 재시도되므로 조용히 둠)
  if (!opts.dry && failed > 0 && done === 0) {
    await sendAlert(env("DISCORD_WEBHOOK_URL"), { title: "사업영역 판정 전량 실패", description: `발행 후 사업영역 판정이 ${failed}건 모두 실패했습니다: ${lastError}`, level: "error" });
  }
  return { ok: true, processed: done, classified, empty, failed, remaining, duration_ms: Date.now() - start, sample };
}
