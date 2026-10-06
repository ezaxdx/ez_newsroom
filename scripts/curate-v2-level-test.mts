// 레벨 기준 시험 — 최근 큐레이션 기사(원문 저장분)에 새 레벨 기준을 다시 적용해 분포를 비교. DB 에는 쓰지 않음.
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-level-test.mts [기사수=40]
import fs from "node:fs";
import { generateArticle } from "../supabase/functions/curate-v2/lib/ai.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const get = async (p: string) => (await fetch(`${base}/rest/v1/${p}`, { headers: H })).json();
const N = Number(process.argv[2] ?? 40);

const rows: any[] = await get(`news?select=id,title,level,category,original_url&created_at=gte.2026-10-06T08:10:00Z&order=created_at.desc&limit=${N}`);
const older: any[] = await get(`news?select=id,title,level,category,original_url&created_at=lt.2026-10-06T08:10:00Z&created_at=gte.2026-10-01T00:00:00Z&order=created_at.desc&limit=${N}`);
const sample = [...rows, ...older].slice(0, N);
const texts: Record<string, string> = {};
const ids = sample.map((r) => r.id).join(",");
for (const t of await get(`news_original_text?select=news_id,original_text&news_id=in.(${ids})`)) texts[t.news_id] = t.original_text;
const items = sample.filter((r) => texts[r.id]);

const cs = await get("curation_settings?select=category_settings,level_prompts&limit=1");
const catSettings = cs[0]?.category_settings ?? {};
const levelPrompts = cs[0]?.level_prompts ?? {};
const cnt = (arr: string[]) => Object.entries(arr.reduce((m: Record<string, number>, k) => (m[k] = (m[k] ?? 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(" · ");

console.log(`시험 ${items.length}건 (원문 저장분)`);
const out: { title: string; before: string | null; after: string; axes: unknown }[] = [];
let idx = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (idx < items.length) {
    const r = items[idx++];
    const cats = [r.category && catSettings[r.category] ? r.category : "MICE"];
    const g = await generateArticle({ apiKey: env.GOOGLE_AI_API_KEY, articleText: texts[r.id], url: r.original_url, categories: cats, catSettings, levelPrompts, calibrated: true });
    if (g.ok) out.push({ title: r.title, before: r.level, after: g.value.level, axes: g.value.level_axes });
  }
}));
console.log("이전 판정:", cnt(out.map((o) => o.before ?? "-")));
console.log("새 기준  :", cnt(out.map((o) => o.after)));
for (const lv of ["Beginner", "Intermediate", "Advanced"]) {
  console.log(`\n── ${lv} (${out.filter((o) => o.after === lv).length}건)`);
  for (const o of out.filter((x) => x.after === lv).slice(0, 8)) console.log(`  ${JSON.stringify(o.axes)} (이전 ${o.before}) ${o.title.slice(0, 46)}`);
}
