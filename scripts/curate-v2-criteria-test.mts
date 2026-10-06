// 사업영역 분류 기준 효과 시험 — 회사 소개 문서(company_context)에 "분류 판단 기준"을 넣기 전/후를 같은 조건에서 비교
//  실제 기사 작성 호출(generateArticle)이 내놓는 business_domains 를 관리자 보정 11건(정답)과 대조 (하나씩 빼고)
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-criteria-test.mts <기준 넣기 전 문서 txt 경로>
// DB 는 읽기만, 아무것도 저장하지 않음.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { canonicalDomain, generateArticle } from "../supabase/functions/curate-v2/lib/ai.ts";
import { CHROME_UA, extractText, mapPool } from "../supabase/functions/curate-v2/lib/util.ts";
import { resolveNaverBlogUrl } from "../supabase/functions/curate-v2/lib/fetchers.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const oldCtx = fs.readFileSync(process.argv[2], "utf8");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: s } = await db.from("curation_settings").select("company_context, business_domain_examples, category_settings, level_prompts").limit(1).single();
const newCtx: string = s!.company_context;
const examples: { title: string; business_domains: string[] }[] = s!.business_domain_examples ?? [];
const hint = (ex: typeof examples) => ex.length ? `\n\n【사업영역 분류 확정 예시 — 관리자가 직접 검수함, 비슷한 유형의 제목은 이 사례를 참고해 분류하세요】\n` + ex.map((e) => `- "${e.title}" → ${JSON.stringify(e.business_domains)}`).join("\n") : "";
const textOf = async (url: string) => { try { const t = resolveNaverBlogUrl(url); const r = await fetch(t, { headers: { "User-Agent": CHROME_UA }, signal: AbortSignal.timeout(8000), redirect: "follow" }); return r.ok ? extractText(await r.text()) : ""; } catch { return ""; } };
const canon = (a: string[] | undefined) => [...new Set((a ?? []).map(canonicalDomain).filter(Boolean) as string[])].sort();
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type Row = { title: string; cat: string; text: string; url: string; want: string[]; k: number };
const rows: Row[] = [];
for (let k = 0; k < examples.length; k++) {
  const { data } = await db.from("news").select("title, category, original_url").ilike("title", `%${examples[k].title.slice(0, 14).replace(/[%_]/g, "")}%`).limit(1);
  const r = data?.[0]; if (!r) continue; const text = await textOf(r.original_url); if (text.length < 300) continue;
  rows.push({ title: r.title, cat: r.category, text, url: r.original_url, want: canon(examples[k].business_domains), k });
}
const run = async (label: string, ctx: string) => {
  const res = await mapPool(rows, 4, async (r) => {
    const g = await generateArticle({ apiKey: env.GOOGLE_AI_API_KEY, articleText: r.text, url: r.url, categories: [r.cat], catSettings: s!.category_settings ?? {}, levelPrompts: s!.level_prompts ?? {}, companyContext: ctx + hint(examples.filter((_, i) => i !== r.k)), calibrated: true });
    return g.ok ? canon(g.value.business_domains) : null;
  });
  let exact = 0, overlap = 0, extra = 0, missing = 0, tags = 0;
  console.log(`\n=== ${label} ===`);
  rows.forEach((r, i) => { const got = res[i]; if (!got) { console.log("  (AI 실패)", r.title.slice(0, 30)); return; }
    const ok = eq(r.want, got); if (ok) exact++; if (r.want.some((w) => got.includes(w))) overlap++;
    extra += got.filter((g) => !r.want.includes(g)).length; missing += r.want.filter((w) => !got.includes(w)).length; tags += got.length;
    console.log(`  ${ok ? "O" : "X"} 정답 ${JSON.stringify(r.want)} / AI ${JSON.stringify(got)} | ${r.title.slice(0, 34)}`); });
  console.log(`  → 완전 일치 ${exact}/${rows.length}, 정답에 없는 태그를 더 붙인 수 ${extra}, 정답 태그를 빠뜨린 수 ${missing}, 태그 합계 ${tags}`);
  return { exact, extra, missing };
};
const a = await run("기준 넣기 전 (기존 회사 소개 문서)", oldCtx);
const b = await run("기준 넣은 후 (현재 회사 소개 문서)", newCtx);
console.log(`\n요약: 완전 일치 ${a.exact} → ${b.exact} / 더 붙인 태그 ${a.extra} → ${b.extra} / 빠뜨린 태그 ${a.missing} → ${b.missing}`);
