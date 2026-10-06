// 중복 보강 시험 — DB 에 쓰지 않고, 이번 큐레이션 기사끼리·직전 기사와의 유사도 + AI 판정을 확인
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-dedupe-test.mts [일수=14]
import fs from "node:fs";
import { judgeSameStory } from "../supabase/functions/curate-v2/lib/ai.ts";
import { isSameStory, storySim, STORY_SIM_ASK, STORY_SIM_SAME } from "../supabase/functions/curate-v2/lib/util.ts";
const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const days = Number(process.argv[2] ?? 14);
const since = new Date(Date.now() - days * 86400000).toISOString();
const rows: any[] = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/news?select=id,title,summary_short&created_at=gte.${since}&order=created_at.desc&limit=400`, { headers: H })).json();
console.log(`기사 ${rows.length}건 (최근 ${days}일) — 쌍 비교`);
const pairs: { a: any; b: any; sim: number; old: boolean }[] = [];
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const sim = storySim({ title: rows[i].title, text: rows[i].summary_short }, { title: rows[j].title, text: rows[j].summary_short });
  if (sim >= STORY_SIM_ASK) pairs.push({ a: rows[i], b: rows[j], sim, old: isSameStory(rows[i].title, rows[j].title) });
}
pairs.sort((x, y) => y.sim - x.sim);
console.log(`유사도 ${STORY_SIM_ASK} 이상 쌍 ${pairs.length}개 (기존 제목 규칙으로 잡히던 것 ${pairs.filter((p) => p.old).length}개)`);
for (const p of pairs.slice(0, 30)) {
  const ai = p.sim >= STORY_SIM_SAME ? "자동묶음" : await judgeSameStory({ apiKey: env.GOOGLE_AI_API_KEY, a: { title: p.a.title, text: p.a.summary_short }, b: { title: p.b.title, text: p.b.summary_short } });
  console.log(`\n${p.sim.toFixed(2)} ${p.old ? "[기존규칙O]" : "[새로 잡힘]"} AI=${ai}\n  A ${p.a.title.slice(0, 60)}\n  B ${p.b.title.slice(0, 60)}`);
}
