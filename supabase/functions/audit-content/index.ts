// Supabase Edge Function — audit-content
// 발행된 기사의 제목·요약·본문이 원문에 충실한지(할루시네이션·왜곡 여부) Gemini로 재검증.
// 이미 감사한 기사(audited_at 존재)는 건너뛰어 실행할 때마다 새로 생성된 기사만 처리.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

async function fetchOriginalText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    return extractText(html);
  } catch {
    return "";
  }
}

async function auditOne(
  apiKey: string,
  originalText: string,
  title: string,
  summary: string,
  contentLong: string
): Promise<{ faithfulness_score: number; issues: string[] } | null> {
  const prompt = `다음은 뉴스 원문과, 이를 바탕으로 AI가 생성한 기사입니다. 생성된 기사가 원문 내용에 얼마나 충실한지 평가하세요.

평가 기준:
- 원문에 없는 사실을 지어내지 않았는가 (할루시네이션)
- 제목이 원문 내용을 과장하거나 왜곡하지 않았는가
- 요약·본문이 원문의 핵심을 정확히 전달하는가 (숫자·고유명사 오류 포함)

원문(최대 6000자):
${originalText}

생성된 기사:
제목: ${title}
요약: ${summary}
본문: ${contentLong}

JSON으로만 응답하세요 (마크다운 없이):
{"faithfulness_score": 8, "issues": ["구체적 문제점만 나열, 없으면 빈 배열"]}
- faithfulness_score: 1~10 정수. 10=완벽히 충실, 5~6=사소한 과장/누락, 1~3=원문에 없는 내용 포함 또는 심각한 왜곡`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const json = await res.json();
    if (!res.ok) { console.error("[Gemini error]", json); return null; }
    const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw);
    if (typeof parsed.faithfulness_score !== "number") return null;
    if (!Array.isArray(parsed.issues)) parsed.issues = [];
    return parsed;
  } catch (e) {
    console.error("[audit 실패]", e);
    return null;
  }
}

const TIME_BUDGET_MS = 130_000; // Edge Function 150초 한계 대비
const BATCH_LIMIT = 150; // 1회 실행당 처리 상한 (나머지는 다음 실행에서 이어서)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });

  const authHeader = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const validAuth = !cronSecret
    || authHeader === `Bearer ${cronSecret}`
    || cronHeader === cronSecret
    || authHeader === `Bearer ${serviceRoleKey}`;
  if (!validAuth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY 없음" }), { status: 500 });

  const { data: targets } = await supabase
    .from("news")
    .select("id, title, summary_short, content_long, original_url")
    .eq("is_published", true)
    .is("audited_at", null)
    .order("published_at", { ascending: false })
    .limit(BATCH_LIMIT);

  const runStart = Date.now();
  let audited = 0, skipped = 0, failed = 0;
  const lowScoreItems: { id: string; title: string; score: number; issues: string[] }[] = [];
  let budgetExceeded = false;

  for (const n of targets ?? []) {
    if (Date.now() - runStart > TIME_BUDGET_MS) { budgetExceeded = true; break; }

    const originalText = await fetchOriginalText(n.original_url);
    if (originalText.length < 200) {
      // 원문 접근 불가(봇 차단 등) — 재검증 불가 상태로 기록해 매 실행마다 재시도하지 않게 함
      await supabase.from("news").update({
        audited_at: new Date().toISOString(),
        faithfulness_score: null,
        faithfulness_issues: ["원문 접근 불가 — 재검증 불가"],
      }).eq("id", n.id);
      skipped++;
      continue;
    }

    const result = await auditOne(apiKey, originalText, n.title, n.summary_short ?? "", n.content_long ?? "");
    if (!result) { failed++; continue; }

    await supabase.from("news").update({
      audited_at: new Date().toISOString(),
      faithfulness_score: result.faithfulness_score,
      faithfulness_issues: result.issues,
    }).eq("id", n.id);
    audited++;
    if (result.faithfulness_score <= 6 || result.issues.length > 0) {
      lowScoreItems.push({ id: n.id, title: n.title, score: result.faithfulness_score, issues: result.issues });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    audited, skipped, failed,
    remaining_estimate: (targets?.length ?? 0) - audited - skipped - failed,
    budget_exceeded: budgetExceeded,
    low_score_items: lowScoreItems,
    duration_ms: Date.now() - runStart,
  }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
});
