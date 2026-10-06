// curate-v2 로컬 시험 실행 — Edge 함수와 같은 파이프라인 코드를 Node 로 그대로 실행
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-local.mts [--max-ai=4] [--only=소스명] [--log]
// 항상 시험 실행(dry): 기사·소스상태·건너뜀 기록을 저장하지 않음. --log 를 주면 curation_logs 에 dry 기록 1건만 남김.
// DB 는 운영 DB 를 읽기만 하고, Gemini·네이버 API 는 실제로 호출함(소량).
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runCuration } from "../supabase/functions/curate-v2/lib/pipeline.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// --new-sources: DB 의 소스 대신 supabase/revamp/new_sources.json(전환 후 설정)만 사용해 시험 — DB 는 바꾸지 않음
const newSources = process.argv.includes("--new-sources")
  ? JSON.parse(fs.readFileSync(new URL("../supabase/revamp/new_sources.json", import.meta.url), "utf8"))
  : undefined;
const result = await runCuration(
  { supabase, env: (k) => env[k], log: (m) => console.log(m) },
  { dry: true, maxAi: Number(arg("max-ai") ?? 4), onlySource: arg("only"), budgetMs: 150_000, writeLog: process.argv.includes("--log"), extraSources: newSources, replaceSources: !!newSources, calibrated: process.argv.includes("--calibrated") ? true : undefined },
);
const { sources, decisions, selected, ...summary } = result as any;
console.log("\n===== 요약 =====\n" + JSON.stringify(summary, null, 1));
console.log("\n===== 소스별 =====");
for (const s of sources) console.log(`${s.status.padEnd(7)} ${String(s.fetched).padStart(3)}건 선정${String(s.kept).padStart(2)} | ${s.name} (${s.type})${s.mode === "render" ? " [렌더링]" : ""}${s.error ? "  ⚠ " + s.error : ""}  ${JSON.stringify(s.reasons)}`);
console.log("\n===== 선정된 기사 =====");
for (const c of selected) console.log(`${c.pick ? "★" : " "} [${c.cats.join("/")}] ${c.title.slice(0, 60)}  ← ${c.source} (${c.vias.join(",")})${c.coverage > 1 ? ` 매체${c.coverage}` : ""}${c.hasText ? "" : " (원문 없음)"}`);
console.log("\n===== AI 작성 결과 =====");
for (const d of decisions) console.log(`${d.decision.padEnd(13)} ${d.category}${d.cats.length > 1 ? "(AI판단: " + d.category_reason + ")" : ""} 품질${d.score} 적합${d.fit}${d.pick ? " ★" + d.pick : ""} | ${d.title}`);
