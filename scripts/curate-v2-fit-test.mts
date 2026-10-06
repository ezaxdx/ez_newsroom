// 적합성 판정 검증 — 관리자가 판정한 12건을 "하나씩 빼고" 판정시켜 일반화되는지 확인 (그 기사 자체는 예시에서 제외)
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-fit-test.mts [--pool=40]
//   --pool=N : 실제 수집 후보(걸러지기 전) N건의 적합성 분포도 확인 (시험 실행의 선정 후보 사용)
// DB 는 읽기만 하고 아무것도 저장하지 않음. Gemini 는 실제 호출.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { FIT_ANCHORS, judgeFit } from "../supabase/functions/curate-v2/lib/ai.ts";
import { CHROME_UA, extractText } from "../supabase/functions/curate-v2/lib/util.ts";
import { fetchNaverSearch } from "../supabase/functions/curate-v2/lib/fetchers.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const textOf = async (url: string) => {
  try { const r = await fetch(url, { headers: { "User-Agent": CHROME_UA }, signal: AbortSignal.timeout(8000), redirect: "follow" }); return r.ok ? extractText(await r.text()) : ""; } catch { return ""; }
};

// FIT_ANCHORS 순서와 같은 12건: [DB 제목 검색어, (없을 때) 네이버 검색 {query, must, cat}]
const FIND: { db: string; naver?: { query: string; must: string[]; cat: string } }[] = [
  { db: "AI%활용%격차%심화" }, { db: "PPT%디자인" }, { db: "AI%부트캠프" }, { db: "메타%AI%글래스" }, { db: "AX%인사이트%리포트" }, { db: "캠퍼스%데이터" },
  { db: "PWCC", naver: { query: "킨텍스 PWCC 플래티넘", must: ["PWCC"], cat: "MICE" } },
  { db: "우주%AI%솔루션" },
  { db: "비템포", naver: { query: "CJ온스타일 킨텍스 비템포", must: ["비템포"], cat: "MICE" } },
  { db: "남해캠퍼스%실무" },
  { db: "세계대학평가", naver: { query: "전북대 THE 세계대학평가", must: ["세계대학평가"], cat: "TOURISM" } },
  { db: "U대회", naver: { query: "국감 충청 U대회 재원", must: ["U대회"], cat: "TOURISM" } },
];
const verdict = (fit: number) => (fit >= 8 ? "꼭 실음" : fit >= 5 ? "대기열" : "싣지않음");
const decide = (fit: number) => (fit >= 7 ? "꼭 실음" : fit >= 5 ? "대기열" : "싣지않음");

let hit = 0, total = 0;
console.log("=== 하나씩 빼고 검증 (관리자 판정 ↔ AI 판정) ===");
for (let k = 0; k < FIND.length; k++) {
  const f = FIND[k];
  const { data } = await db.from("news").select("title, category, original_url").ilike("title", `%${f.db}%`).order("created_at", { ascending: false }).limit(1);
  let row = data?.[0] as { title: string; category: string; original_url: string } | undefined;
  if (!row && f.naver) {
    try {
      const r = await fetchNaverSearch(f.naver.query, { naverId: env.NAVER_CLIENT_ID, naverSecret: env.NAVER_CLIENT_SECRET }, 10);
      const it = r.items.find((x) => f.naver!.must.every((m) => x.title.includes(m)));
      if (it) row = { title: it.title, category: f.naver.cat, original_url: it.link };
    } catch { /* 아래 */ }
  }
  if (!row) { console.log(`  (기사 없음) ${f.db}`); continue; }
  const text = await textOf(row.original_url);
  if (text.length < 300) { console.log(`  (원문 못 읽음) ${row.title.slice(0, 40)}`); continue; }
  const r = await judgeFit({ apiKey: env.GOOGLE_AI_API_KEY, title: row.title, text, category: row.category, fitAnchors: FIT_ANCHORS.filter((_, i) => i !== k) });
  if (!r.ok) { console.log(`  (AI 실패) ${row.title.slice(0, 40)}: ${r.error}`); continue; }
  const want = verdict(FIT_ANCHORS[k].fit), got = decide(r.fit);
  total++; if (want === got) hit++;
  console.log(`  ${want === got ? "O" : "X"} 관리자:${want.padEnd(5)} AI:${got.padEnd(5)}(fit ${r.fit}) [${row.category}] ${row.title.slice(0, 42)}\n       └ ${r.reason.slice(0, 110)}`);
}
console.log(`\n일치 ${hit}/${total}`);

const n = Number((process.argv.find((a) => a.startsWith("--pool=")) ?? "").split("=")[1] ?? 0);
if (n > 0) {
  // 실제 수집 후보 풀: 최근 7일 이내 등록(created_at)된 기사 중 카테고리별로 골고루 — 대기열·발행 모두 포함
  const { data: rows } = await db.from("news").select("title, category, original_url, is_published, quality_criteria").neq("category", "EZPMP").order("created_at", { ascending: false }).limit(300);
  const pick = (rows ?? []).sort(() => Math.random() - 0.5).slice(0, n);
  const dist: Record<string, number> = {}; const lows: string[] = []; const mids: string[] = []; let idx = 0, done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (idx < pick.length) {
      const row = pick[idx++]; const text = await textOf(row.original_url); if (text.length < 300) continue;
      const r = await judgeFit({ apiKey: env.GOOGLE_AI_API_KEY, title: row.title, text, category: row.category, fitAnchors: FIT_ANCHORS }); if (!r.ok) continue;
      done++; const b = r.fit >= 7 ? "발행(7+)" : r.fit >= 5 ? "대기열(5~6)" : "폐기(≤4)"; dist[b] = (dist[b] ?? 0) + 1;
      if (r.fit < 5) lows.push(`  [${row.category}] fit ${r.fit} ${row.title.slice(0, 44)} ← ${r.reason.slice(0, 60)}`);
      else if (r.fit < 7) mids.push(`  [${row.category}] fit ${r.fit} ${row.title.slice(0, 44)} ← ${r.reason.slice(0, 60)}`);
    }
  }));
  console.log(`\n=== 기존 발행·대기 기사 ${done}건을 새 기준으로 ===\n`, JSON.stringify(dist));
  console.log("\n폐기 대상:\n" + (lows.slice(0, 12).join("\n") || "  (없음)") + "\n\n대기열 대상:\n" + (mids.slice(0, 12).join("\n") || "  (없음)"));
}
