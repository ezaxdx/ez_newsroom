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

/**
 * 콘텐츠 품질 감사에서 걸린 기사를 원문+발견된 문제점을 근거로 AI가 다시 작성 — 자동 저장은 하지 않고
 * 제안만 반환. 관리자가 검토·수정 후 /api/admin/news/update-content로 저장해야 반영됨.
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: n } = await supabase.from("news")
    .select("title, summary_short, content_long, implications, original_url, faithfulness_issues")
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
    originalText = extractText(await res.text());
  } catch { /* 원문 재접근 실패 — 아래에서 처리 */ }

  if (originalText.length < 200) {
    return NextResponse.json({ error: "원문에 다시 접근할 수 없어 AI 수정을 진행할 수 없습니다. 직접 수정해주세요." }, { status: 422 });
  }

  const issues: string[] = Array.isArray(n.faithfulness_issues) ? n.faithfulness_issues : [];
  const prompt = `다음은 뉴스 원문과, 문제가 있다고 지적된 기존 생성 기사입니다. 지적된 문제점을 고쳐서 원문에 충실한 새 버전을 작성하세요.

지적된 문제점:
${issues.map((i) => `- ${i}`).join("\n") || "(구체적 지적 없음 — 전반적으로 원문에 더 충실하게 다시 작성)"}

원문(최대 6000자):
${originalText}

기존(문제 있는) 생성본:
제목: ${n.title}
요약: ${n.summary_short}
본문: ${n.content_long}
시사점: ${n.implications ?? ""}

JSON으로만 응답하세요 (마크다운 없이). 시사점은 기존 톤(회사 관점 연결)을 유지하되 원문에 있는 내용만 근거로 삼으세요:
{"title":"수정된 제목(50자이내)","summary_short":"수정된 요약(120자이내)","content_long":"수정된 상세분석(4~6문장)","implications":"수정된 시사점(2~3문장)"}`;

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
    if (!res.ok) return NextResponse.json({ error: "AI 수정 생성 실패" }, { status: 500 });
    const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const fixed = JSON.parse(raw);
    return NextResponse.json({ ok: true, fixed });
  } catch {
    return NextResponse.json({ error: "AI 수정 생성 중 오류" }, { status: 500 });
  }
}
