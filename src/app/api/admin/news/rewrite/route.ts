import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const maxDuration = 60;

const DEFAULT_PERSONA: Record<string, string> = {
  AI: "당신은 AI·디지털 전환 전문 에디터입니다. MICE·관광 산업 종사자가 즉시 활용할 수 있는 실용적 시각으로 AI 기술 뉴스를 분석합니다.",
  MICE: "당신은 MICE 산업 전문 에디터입니다. 컨벤션·전시·이벤트 기획자 관점에서 운영 효율화와 참가자 경험 향상에 초점을 맞춥니다.",
  TOURISM: "당신은 관광·여행 산업 전문 에디터입니다. 지자체·OTA·숙박업 관계자가 활용할 수 있는 관광 트렌드와 전략적 시사점을 분석합니다.",
  EZPMP: "당신은 EZPMP(이즈피엠피)의 홍보 에디터입니다. EZPMP는 MICE·행사 기획 및 운영 솔루션을 제공하는 기업입니다. EZPMP의 서비스·실적·소식을 중심으로 신뢰감 있고 전문적인 기업 소식으로 작성합니다.",
};
const DEFAULT_LEVEL: Record<string, string> = {
  Beginner: "【독자 수준: 입문】 업계 배경지식이 없는 독자를 위해 전문 용어는 쉽게 풀어 설명하고, 짧고 명확한 문장으로 작성하세요.",
  Intermediate: "【독자 수준: 실무】 업계 기본 지식을 보유한 실무 담당자를 위해 업계 용어를 자연스럽게 사용하고, 현장에서 즉시 적용 가능한 관점으로 작성하세요.",
  Advanced: "【독자 수준: 전략】 전략·기획자를 위해 산업 구조 변화와 거시적 시사점을 심층 분석하세요.",
};

function extractText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
}

/**
 * 기사를 다른 카테고리 관점으로 "다시 쓴 안"을 만들어 돌려줌 — 저장하지 않음 (교체 여부는 관리자가 비교 후 결정).
 * 원문은 큐레이션 때 저장해 둔 것(news_original_text)을 우선 사용하고, 없는 예전 기사만 원문 주소를 다시 읽음.
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, category, level: levelParam } = await req.json();
  if (!id || typeof category !== "string") return NextResponse.json({ error: "id, category 필요" }, { status: 400 });
  const cat = category.toUpperCase();
  // 글 수준(레벨): 지정하지 않으면 기사의 현재 레벨을 그대로 씀
  const levelOverride = ["Beginner", "Intermediate", "Advanced"].includes(levelParam) ? (levelParam as string) : null;

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_AI_API_KEY not configured" }, { status: 500 });

  const supabase = createAdminClient();
  const { data: news } = await supabase.from("news").select("title, original_url, level, category").eq("id", id).single();
  if (!news) return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });

  let text = "";
  const { data: stored } = await supabase.from("news_original_text").select("original_text").eq("news_id", id).maybeSingle();
  const hasStored = !!stored?.original_text;
  if (hasStored) text = stored!.original_text;
  else {
    try {
      const res = await fetch(news.original_url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "Accept-Language": "ko-KR,ko;q=0.9" },
        signal: AbortSignal.timeout(8000), redirect: "follow",
      });
      if (res.ok) text = extractText(await res.text());
    } catch { /* 아래에서 처리 */ }
  }
  if (text.length < 200) {
    // 저장해 둔 원문이 있으면(큐레이션 v2 이후 기사) 여기까지 올 일이 거의 없음 — 저장 원문이 없는 예전 기사가 원문 주소에서도 안 읽힌 경우를 구분해서 알림
    const error = hasStored
      ? "저장해 둔 원문이 너무 짧아(200자 미만) 다시 쓸 수 없습니다. 카테고리만 변경할 수 있어요."
      : "이 기사는 원문을 저장해 두기 전에 만들어진 예전 기사라 원문 주소에서 다시 읽어야 하는데, 지금 읽지 못했습니다(주소 만료·접근 차단·본문 짧음 등). 카테고리만 변경할 수 있어요.";
    return NextResponse.json({ error, reason: hasStored ? "stored_too_short" : "no_stored_text_fetch_failed" }, { status: 422 });
  }

  const { data: settings } = await supabase.from("curation_settings").select("category_settings, level_prompts, company_context").limit(1).single();
  const cs = settings?.category_settings?.[cat] ?? {};
  const level = levelOverride ?? news.level ?? "Intermediate";
  const levelGuide = settings?.level_prompts?.[cat]?.[level] ?? settings?.level_prompts?.[level] ?? DEFAULT_LEVEL[level] ?? DEFAULT_LEVEL.Intermediate;
  const persona = cs.persona ?? DEFAULT_PERSONA[cat] ?? DEFAULT_PERSONA.MICE;

  const prompt = `${persona}
타겟 독자: ${cs.audience ?? "MICE·관광 업계 종사자"}${cs.keywords?.length ? `\n강조 키워드: ${cs.keywords.join(", ")}` : ""}
${levelGuide}

이 기사는 기존에 "${news.category}" 관점으로 작성되었지만 "${cat}" 카테고리로 분류가 바뀌었습니다. 아래 원문을 "${cat}" 관점으로 다시 작성하세요.
원문에 없는 사실을 지어내지 말고, 수치·고유명사는 원문 그대로 쓰세요.

문체 규칙: '~습니다/~입니다' 경어체. 신문체('~다', '~한다') 사용 금지. 제목은 명사형 또는 단문으로 끝낼 것('~입니다' 금지).

JSON으로만 응답하세요 (마크다운 없이):
{"title":"제목(50자이내)","summary_short":"요약(2~3문장, 120자이내)","content_long":"상세분석(4~6문장)","implications":"시사점(2~3문장)"}

원문 URL: ${news.original_url}
원문:
${text}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        ...(settings?.company_context?.trim() ? { systemInstruction: { parts: [{ text: settings.company_context.trim() }] } } : {}),
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(40000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const parts: Array<{ text?: string; thought?: boolean }> = json.candidates?.[0]?.content?.parts ?? [];
    const raw = (parts.find((p) => !p.thought && typeof p.text === "string")?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw);
    if (!parsed.title || !parsed.summary_short || !parsed.content_long) throw new Error("응답에 필요한 항목이 없습니다");
    return NextResponse.json({ title: parsed.title, summary_short: parsed.summary_short, content_long: parsed.content_long, implications: parsed.implications ?? "" });
  } catch (e) {
    return NextResponse.json({ error: "AI로 다시 쓰는 중 오류가 발생했습니다.", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
