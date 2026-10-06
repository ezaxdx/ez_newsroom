// 행사 점수 계산에 필요한 서버 쪽 데이터 로더 — 키워드 희소성(IDF), 주최사 가산 목록, 가중치 설정
// 뉴스레터·홈·행사 캘린더가 같은 context 를 쓰도록 한 곳에서 만든다. (순수 계산은 event-score.ts)

import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_SCORE_KEYWORDS, DEFAULT_ORGS, kwMatch, type OrgTier, type ScoringContext, type ScoreWeights } from "@/lib/event-score";

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; ctx: ScoringContext } | null = null;

export function clearScoringContextCache() { cache = null; }

export async function loadScoringContext(supabase: SupabaseClient): Promise<ScoringContext> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ctx;

  const ctx: ScoringContext = {};

  // 1) 키워드 희소성 — 공개 행사 전체에서 키워드가 얼마나 흔한지로 계산 (행사가 쌓일수록 자동으로 맞춰짐)
  try {
    const { data } = await supabase
      .from("convention_events")
      .select("event_name, event_name_en, category")
      .eq("is_published", true)
      .limit(5000);
    const rows = (data ?? []) as { event_name: string; event_name_en: string | null; category: string | null }[];
    if (rows.length >= 100) {   // 표본이 너무 작으면 기본값(DEFAULT_IDF)이 더 안정적
      const texts = rows.map((r) => `${r.event_name} ${r.event_name_en ?? ""} ${r.category ?? ""}`.toLowerCase());
      const idf: Record<string, number> = {};
      for (const kw of ALL_SCORE_KEYWORDS) {
        const df = texts.filter((t) => kwMatch(t, kw)).length;
        idf[kw] = Math.round(Math.log((rows.length + 1) / (df + 1)) * 10) / 10;
      }
      ctx.idf = idf;
    }
  } catch { /* 기본값 사용 */ }

  // 2) 주최사 가산 목록 — 08_event_scoring.sql 적용 전이거나 비어 있으면 코드 기본 목록
  try {
    const { data, error } = await supabase.from("event_org_affinity").select("org_key, tier, hit_count");
    if (!error && data && data.length > 0) {
      ctx.orgs = (data as { org_key: string; tier: OrgTier; hit_count: number | null }[])
        .map((r) => ({ key: r.org_key, tier: r.tier, hit: r.hit_count ?? 1 }));
    } else {
      ctx.orgs = DEFAULT_ORGS;
    }
  } catch { ctx.orgs = DEFAULT_ORGS; }

  // 3) 가중치 덮어쓰기
  try {
    const { data } = await supabase.from("event_scoring_settings").select("weights").eq("id", 1).maybeSingle();
    const w = (data as { weights: Partial<ScoreWeights> | null } | null)?.weights;
    if (w && Object.keys(w).length) ctx.weights = w;
  } catch { /* 기본값 */ }

  cache = { at: Date.now(), ctx };
  return ctx;
}
