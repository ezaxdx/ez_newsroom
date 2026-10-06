// 사업영역 분류 시험 — 별도 판정 호출(judgeDomains) vs 기존(기사 작성과 같은 호출) 비교
//  1) 관리자가 직접 보정한 사례(정답)를 "하나씩 빼고" 맞추는지
//  2) 기존 발행 기사 N건에서 기존 태그와 새 판정이 어떻게 다른지
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-domain-test.mts [--sample=50]
// DB 는 읽기만 하고 아무것도 저장하지 않음. Gemini 는 실제 호출.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { canonicalDomain, DOMAIN_NAMES, judgeDomains } from "../supabase/functions/curate-v2/lib/ai.ts";
import { CHROME_UA, extractText, mapPool } from "../supabase/functions/curate-v2/lib/util.ts";
import { resolveNaverBlogUrl } from "../supabase/functions/curate-v2/lib/fetchers.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const n = Number((process.argv.find((a) => a.startsWith("--sample=")) ?? "").split("=")[1] ?? 50);
const textOf = async (url: string) => {
  try { const t = resolveNaverBlogUrl(url); const r = await fetch(t, { headers: { "User-Agent": CHROME_UA, ...(t !== url ? { Referer: "https://blog.naver.com/" } : {}) }, signal: AbortSignal.timeout(8000), redirect: "follow" }); return r.ok ? extractText(await r.text()) : ""; } catch { return ""; }
};
const canon = (a: string[] | null | undefined) => [...new Set((a ?? []).map(canonicalDomain).filter(Boolean) as string[])].sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const { data: s } = await db.from("curation_settings").select("business_domain_examples").limit(1).single();
const examples: { title: string; business_domains: string[] }[] = s?.business_domain_examples ?? [];

/* 1) 정답(관리자 보정)을 하나씩 빼고 맞추는지 */
console.log(`=== 1) 관리자 보정 사례 ${examples.length}건 — 하나씩 빼고 판정 ===`);
let exact = 0, tested = 0, overlapHit = 0;
for (let k = 0; k < examples.length; k++) {
  const ex = examples[k];
  const { data } = await db.from("news").select("title, original_url").ilike("title", `%${ex.title.slice(0, 14).replace(/[%_]/g, "")}%`).limit(1);
  const row = data?.[0]; if (!row) { console.log(`  (기사 없음) ${ex.title.slice(0, 30)}`); continue; }
  const text = await textOf(row.original_url); if (text.length < 300) { console.log(`  (원문 못 읽음) ${row.title.slice(0, 30)}`); continue; }
  const r = await judgeDomains({ apiKey: env.GOOGLE_AI_API_KEY, title: row.title, text, examples: examples.filter((_, i) => i !== k) });
  if (!r.ok) { console.log(`  (AI 실패) ${r.error}`); continue; }
  const want = canon(ex.business_domains), got = canon(r.domains); tested++;
  const ok = same(want, got); if (ok) exact++; if (want.some((w) => got.includes(w)) || (want.length === 0 && got.length === 0)) overlapHit++;
  console.log(`  ${ok ? "O" : "X"} 정답 ${JSON.stringify(want)} / AI ${JSON.stringify(got)} | ${row.title.slice(0, 36)}`);
}
console.log(`  → 완전 일치 ${exact}/${tested}, 하나라도 겹침 ${overlapHit}/${tested}`);

/* 2) 기존 발행 기사 비교 */
const { data: rows } = await db.from("news").select("title, category, original_url, business_domains").eq("is_published", true).order("created_at", { ascending: false }).limit(400);
const pick = (rows ?? []).sort(() => Math.random() - 0.5).slice(0, n);
type Res = { title: string; cat: string; old: string[]; neu: string[]; ev: Record<string, string> };
const out: Res[] = [];
await mapPool(pick, 6, async (row) => {
  const text = await textOf(row.original_url); if (text.length < 300) return;
  const r = await judgeDomains({ apiKey: env.GOOGLE_AI_API_KEY, title: row.title, text, examples });
  if (r.ok) out.push({ title: row.title, cat: row.category, old: canon(row.business_domains), neu: r.domains.slice().sort(), ev: r.evidence });
});
const stat = (l: string[][]) => ({ avg: (l.reduce((a, x) => a + x.length, 0) / l.length).toFixed(2), none: Math.round(l.filter((x) => x.length === 0).length / l.length * 100), three: l.filter((x) => x.length >= 3).length });
const so = stat(out.map((o) => o.old)), sn = stat(out.map((o) => o.neu));
console.log(`\n=== 2) 기존 발행 기사 ${out.length}건 — 기존 태그 vs 새 판정 ===`);
console.log(`  평균 태그 수:  기존 ${so.avg}개 → 새 ${sn.avg}개`);
console.log(`  미분류 비율:   기존 ${so.none}% → 새 ${sn.none}%`);
console.log(`  3개 이상 태그: 기존 ${so.three}건 → 새 ${sn.three}건`);
const cnt = (l: string[][]) => DOMAIN_NAMES.map((d) => `${d.replace(/\(.*\)/, "")} ${l.filter((x) => x.includes(d)).length}`).join(" · ");
console.log(`  영역별 기존:  ${cnt(out.map((o) => o.old))}\n  영역별 새:    ${cnt(out.map((o) => o.neu))}`);
console.log(`  기존과 완전 동일 ${out.filter((o) => same(o.old, o.neu)).length}건`);
const removed = out.filter((o) => o.old.some((d) => !o.neu.includes(d)));
console.log(`\n--- 기존에 붙었다가 새 판정에서 빠진 태그가 있는 기사 (${removed.length}건 중 12건) ---`);
for (const o of removed.slice(0, 12)) console.log(`  [${o.cat}] ${o.title.slice(0, 40)}\n      기존 ${JSON.stringify(o.old)} → 새 ${JSON.stringify(o.neu)}`);
const added = out.filter((o) => o.neu.some((d) => !o.old.includes(d)));
console.log(`\n--- 새 판정에서 새로 붙은 태그가 있는 기사 (${added.length}건 중 8건) ---`);
for (const o of added.slice(0, 8)) console.log(`  [${o.cat}] ${o.title.slice(0, 40)}\n      기존 ${JSON.stringify(o.old)} → 새 ${JSON.stringify(o.neu)} | 근거: ${Object.values(o.ev)[0]?.slice(0, 70) ?? ""}`);
