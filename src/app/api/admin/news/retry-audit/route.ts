import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const maxDuration = 30;

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

// 봇 차단 페이지(WAF 등)가 200자를 넘겨 실제 원문으로 오인되는 것을 방지
const BLOCK_PAGE_MARKERS = ["access denied", "403 forbidden", "request blocked", "are you a robot", "unusual traffic", "just a moment"];
function looksLikeBlockPage(text: string): boolean {
  const t = text.toLowerCase();
  return BLOCK_PAGE_MARKERS.some((m) => t.includes(m));
}

/**
 * 감사에서 "원문 접근 불가"로 걸렸지만 관리자가 직접 접속해 정상 확인한 경우 —
 * 지금 이 순간 다시 한번 원문을 가져와 즉시 재검증(다음 배치 실행을 기다리지 않음).
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: n } = await supabase.from("news")
    .select("title, summary_short, content_long, original_url")
    .eq("id", id).single();
  if (!n) return NextResponse.json({ error: "기사를 찾을 수 없음" }, { status: 404 });

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_AI_API_KEY 없음" }, { status: 500 });

  let originalText = "";
  try {
    const res = await fetch(n.original_url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 403 && res.status !== 429 && res.status !== 503) {
      originalText = extractText(await res.text());
      if (looksLikeBlockPage(originalText)) originalText = "";
    }
  } catch { /* 아래에서 접근불가로 처리 */ }

  if (originalText.length < 200) {
    await supabase.from("news").update({
      audited_at: new Date().toISOString(),
      faithfulness_score: null,
      faithfulness_issues: ["원문 접근 불가 — 재검증 불가"],
    }).eq("id", id);
    return NextResponse.json({ error: "여전히 원문에 접근할 수 없습니다 (봇 차단 등). 잠시 후 다시 시도해보세요." }, { status: 422 });
  }

  const prompt = `다음은 뉴스 원문과, 이를 바탕으로 AI가 생성한 기사입니다. 생성된 기사가 원문 내용에 얼마나 충실한지 평가하세요.

평가 기준:
- 원문에 없는 사실을 지어내지 않았는가 (할루시네이션)
- 제목이 원문 내용을 과장하거나 왜곡하지 않았는가
- 요약·본문이 원문의 핵심을 정확히 전달하는가 (숫자·고유명사 오류 포함)

원문(최대 6000자):
${originalText}

생성된 기사:
제목: ${n.title}
요약: ${n.summary_short}
본문: ${n.content_long}

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
        signal: AbortSignal.timeout(25000),
      }
    );
    const json = await res.json();
    if (!res.ok) return NextResponse.json({ error: "재검증 생성 실패" }, { status: 500 });
    const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw);
    const faithfulness_score = typeof parsed.faithfulness_score === "number" ? parsed.faithfulness_score : null;
    const faithfulness_issues = Array.isArray(parsed.issues) ? parsed.issues : [];

    await supabase.from("news").update({
      audited_at: new Date().toISOString(),
      faithfulness_score, faithfulness_issues,
      audit_dismissed_at: null, // 재검증했으니 이전 완료처리 상태는 무의미 — 새 결과로 다시 판단
    }).eq("id", id);

    return NextResponse.json({ ok: true, faithfulness_score, issues: faithfulness_issues });
  } catch {
    return NextResponse.json({ error: "재검증 중 오류" }, { status: 500 });
  }
}
