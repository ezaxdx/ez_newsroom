/**
 * Pick 행사 카드용 짧은 소개 문구 생성
 * 우선순위: DB description → Gemini AI 생성
 * 생성 후 DB에 캐시 저장
 */

type EventInput = {
  id: string;
  event_name: string;
  description: string | null;
  website: string | null;
  industry: string | null;
  category: string | null;
  organizer: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export async function fillEventDescriptions(
  events: EventInput[],
  supabase: SupabaseClient,
  apiKey: string | undefined
): Promise<Record<string, string>> {
  // DB에 이미 description 있는 행사는 그대로 사용
  const result: Record<string, string> = {};
  for (const e of events) {
    if (e.description) result[e.id] = e.description;
  }

  const needsDesc = events.filter((e) => !e.description);
  if (needsDesc.length === 0) return result;

  // Gemini로 일괄 생성
  const stillNeedsDesc = needsDesc;
  if (stillNeedsDesc.length === 0 || !apiKey) return result;

  const lines = stillNeedsDesc.map((e, i) => {
    const context = [e.industry, e.category, e.organizer].filter(Boolean).join(", ");
    return `${i + 1}. ${e.event_name}${context ? ` (${context})` : ""}`;
  });

  const prompt = `아래 전시·행사 각각에 대해 15~22자의 짧고 생생한 한 줄 소개를 한국어로 써줘.
분야 나열이 아니라 행사의 핵심을 담은 짧은 문구여야 해.
반드시 명사 또는 명사형으로 끝나야 해 (동사·형용사 어미 금지).
예시: "AI·로봇·반도체 기업이 총집결" / "전력·에너지 기업 상담과 기술 시연" / "국내외 식품기업의 최신 기술을 한눈에" / "스마트 농업의 미래, 농기계와 축산의 혁신"

금지어: 향연, 대향연, 집결지, 성지 (절대 사용 금지)
금지 어미: ~하다, ~이다, ~경험하다, ~만나다 등 동사 원형 어미 사용 금지
합쇼체(~습니다) 불필요.

${lines.join("\n")}

JSON 배열로만 출력 (다른 설명 없이): ["소개1", "소개2", ...]`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 256,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );

    if (!geminiRes.ok) return result;

    const geminiJson = await geminiRes.json();
    const raw = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return result;
    const descriptions: string[] = JSON.parse(jsonMatch[0]);

    await Promise.all(
      stillNeedsDesc.map(async (e, i) => {
        const desc = descriptions[i];
        if (!desc) return;
        result[e.id] = desc;
        await supabase.from("convention_events").update({ description: desc }).eq("id", e.id);
      })
    );
  } catch {
    // AI 실패 시 description 없이 진행
  }

  return result;
}
