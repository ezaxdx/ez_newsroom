// curate-v2 "live" 경로 시뮬레이션 — 읽기는 실제 운영 DB로 하고, 쓰기(insert/upsert/update/delete)는 실행하지 않고 가로채서 기록만 함
// → 실제 발행·삭제·소스상태 변경 없이, 저장 로직(필드·체인 호출)이 오류 없이 도는지 확인
// 디스코드 알림은 보내지 않음(웹훅 환경변수를 비워서 전달). Gemini·네이버는 실제 호출.
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-live-sim.mts
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runCuration } from "../supabase/functions/curate-v2/lib/pipeline.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const real = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

type Write = { table: string; op: string; payload: any; chain: string[] };
const writes: Write[] = [];
const WRITE_OPS = new Set(["insert", "upsert", "update", "delete"]);
const stub = (table: string, op: string, payload: any) => {
  const rec: Write = { table, op, payload, chain: [] };
  writes.push(rec);
  const n = writes.length;
  const p: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: any) => Promise.resolve({ data: op === "insert" || op === "upsert" ? [{ id: `fake-${n}` }] : null, error: null }).then(res);
      return (..._a: any[]) => { rec.chain.push(String(prop)); return p; };
    },
  });
  return p;
};
const sim = {
  from(table: string) {
    const b: any = (real as any).from(table);
    return new Proxy(b, {
      get(t, prop, r) {
        if (WRITE_OPS.has(String(prop))) return (payload: any) => stub(table, String(prop), payload);
        const v = Reflect.get(t, prop, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  },
};

const result: any = await runCuration(
  { supabase: sim, env: (k) => (k === "DISCORD_WEBHOOK_URL" ? undefined : env[k]), log: (m) => console.log(m) },
  { dry: false, budgetMs: 150_000, writeLog: true },
);

console.log("\n===== 실행 결과 =====");
console.log(JSON.stringify({ mode: result.mode, published: result.published, staged: result.staged, skipped: result.skipped, failed: result.failed, deferred: result.deferred, duration_ms: result.duration_ms, alerts: result.alerts }, null, 1));
const by: Record<string, number> = {};
for (const w of writes) by[`${w.table}.${w.op}`] = (by[`${w.table}.${w.op}`] ?? 0) + 1;
console.log("\n===== 가로챈 쓰기 (실행 안 함) =====\n" + JSON.stringify(by, null, 1));
const newsWrite = writes.find((w) => w.table === "news" && w.op === "upsert");
if (newsWrite) {
  const p = { ...newsWrite.payload }; for (const k of ["content_long", "implications", "summary_short"]) if (p[k]) p[k] = String(p[k]).slice(0, 40) + "…";
  console.log("\n===== news upsert 예시 =====\n" + JSON.stringify(p, null, 1) + "\n체인: " + newsWrite.chain.join("."));
}
const ot = writes.find((w) => w.table === "news_original_text");
if (ot) console.log("\nnews_original_text 예시:", ot.payload.news_id, `${String(ot.payload.original_text).length}자`);
const seen = writes.find((w) => w.table === "curation_seen" && w.op === "upsert");
if (seen) console.log("curation_seen upsert:", Array.isArray(seen.payload) ? `${seen.payload.length}건, 예: ${JSON.stringify(seen.payload[0])}` : "단건");
const srcUpd = writes.filter((w) => w.table === "rss_sources" && w.op === "update");
console.log(`rss_sources 상태 업데이트 ${srcUpd.length}건, 예:`, JSON.stringify(srcUpd[0]?.payload));
const log = writes.find((w) => w.table === "curation_logs");
console.log("curation_logs insert:", log ? `run_mode=${log.payload.run_mode} fetched=${log.payload.fetched} published=${log.payload.published} errors=${(log.payload.errors ?? []).length}` : "없음");
const del = writes.filter((w) => w.op === "delete");
console.log("delete 호출:", del.map((d) => `${d.table}(${d.chain.join(".")})`).join(", ") || "없음");
