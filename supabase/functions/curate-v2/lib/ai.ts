// curate-v2 기사 작성 (Gemini) — v1 프롬프트를 이어받고, 카테고리가 겹칠 때만 AI가 카테고리를 판단
import { sleep } from "./util.ts";

export type CatSetting = { audience: string; persona: string; keywords: string[] };
export interface GenInput {
  apiKey: string;
  articleText: string;
  url: string;
  categories: string[];                                  // 후보 카테고리 — 1개면 확정, 2개 이상이면 AI가 판단
  catSettings: Record<string, CatSetting>;
  levelPrompts: Record<string, Record<string, string>>;
  companyContext?: string;
  hintBlock?: string;                                    // AI 판단 시 참고할 카테고리 힌트 키워드
  eventName?: string;                                    // 이즈픽 행사 관련 기사면 행사명
}
export interface Generated {
  title: string;
  summary_short: string;
  content_long: string;
  implications: string;
  level: string;
  quality_score: number;
  quality_criteria: { relevance: number; specificity: number; practicality: number; source_quality: number; fit: number };
  business_domains: string[];
  category: string;
  category_reason: string | null;
}

export const CATEGORY_CRITERIA = `카테고리 판단 기준:
- MICE: 회의·전시·박람회·행사의 유치/개최/운영·시설·참가자가 기사의 중심
- TOURISM: 관광객·관광지·관광정책·여행 수요·지역관광이 기사의 중심
- AI: AI·기술·도구·업무 자동화 자체가 기사의 중심 (행사·관광은 배경일 뿐)
- EZPMP: 이즈피엠피(EZPMP) 회사·서비스·행사 소식`;

export const DEFAULT_HINTS: Record<string, { strong: string[]; weak: string[] }> = {
  MICE: {
    strong: ["MICE", "마이스", "국제회의", "컨벤션", "전시회", "박람회", "엑스포", "인센티브 관광", "포상관광", "비즈매칭", "수출상담회", "바이어", "학술대회", "콘퍼런스", "총회", "코엑스", "킨텍스", "벡스코", "엑스코", "송도컨벤시아", "대전컨벤션센터", "김대중컨벤션센터", "수원컨벤션센터", "컨벤션뷰로", "한국MICE협회", "ICCA", "UIA", "UFI"],
    weak: ["행사", "유치", "참가자", "포럼", "전시"],
  },
};

export function buildHintBlock(hints: Record<string, { strong?: string[]; weak?: string[] }> | null | undefined): string {
  const h = hints && Object.keys(hints).length ? hints : DEFAULT_HINTS;
  return Object.entries(h)
    .map(([cat, v]) => `- ${cat} 확정 키워드: ${(v.strong ?? []).join(", ")}${v.weak?.length ? ` / 보조(단독으로는 판단 근거 아님): ${v.weak.join(", ")}` : ""}`)
    .join("\n");
}

function levelBlock(cat: string, lp: Record<string, Record<string, string>>): string {
  const l = lp[cat] ?? {};
  return `[Beginner] ${l["Beginner"] ?? "쉽고 명확하게 작성하세요."}
[Intermediate] ${l["Intermediate"] ?? "실무 담당자 관점에서 작성하세요."}
[Advanced] ${l["Advanced"] ?? "전략적 심층 분석으로 작성하세요."}`;
}

function defaultSetting(cat: string): CatSetting {
  return { audience: "MICE·관광 업계 종사자", persona: `당신은 ${cat} 전문 에디터입니다. 업계 종사자 관점에서 핵심 시사점을 분석합니다.`, keywords: [] };
}

export function buildPrompt(i: GenInput): string {
  const multi = i.categories.length > 1;
  const catSection = multi
    ? `【카테고리 판단 — 먼저 할 일】
이 기사의 핵심 주제에 가장 맞는 카테고리를 후보 중 정확히 1개 고르고(category), 그 이유를 한 줄로 쓰세요(category_reason).
그리고 고른 카테고리의 페르소나·타겟 독자·작성 지침으로 기사를 작성하세요.
후보: ${i.categories.join(", ")}
${CATEGORY_CRITERIA}
${i.hintBlock ? `\n참고 키워드(힌트일 뿐 최종 판단은 기사 내용으로):\n${i.hintBlock}\n` : ""}
${i.categories.map((c) => {
      const s = i.catSettings[c] ?? defaultSetting(c);
      return `■ ${c} 관점\n${s.persona}\n타겟 독자: ${s.audience}${s.keywords.length ? `\n강조 키워드: ${s.keywords.join(", ")}` : ""}`;
    }).join("\n\n")}`
    : (() => {
      const c = i.categories[0];
      const s = i.catSettings[c] ?? defaultSetting(c);
      return `${s.persona}\n타겟 독자: ${s.audience}${s.keywords.length ? `\n강조 키워드: ${s.keywords.join(", ")}` : ""}`;
    })();

  const levelSection = multi
    ? i.categories.map((c) => `(${c} 관점일 때)\n${levelBlock(c, i.levelPrompts)}`).join("\n\n")
    : levelBlock(i.categories[0], i.levelPrompts);

  const eventLine = i.eventName
    ? `\n※ 이 기사는 이즈피엠피가 주목하는 행사 "${i.eventName}" 관련 보도입니다. 행사 관련 사실을 정확히 전달하세요.\n`
    : "";

  return `${catSection}
${eventLine}
퀄리티 점수 기준 (각 항목 1~10점, quality_score는 종합 판단):
- relevance(카테고리 관련성): 카테고리·페르소나·키워드와의 일치도
- specificity(구체성): 수치·사례·데이터의 풍부함
- practicality(실용성): 즉시 활용 가능한 시사점 여부
- source_quality(원문품질): 원문 접근 가능성 및 내용 충실도
- fit(회사 적합성): 이 기사가 MICE(전시·컨벤션·국제회의·이벤트 기획·행사 유치/운영) 또는
  관광(특히 스마트관광·지역관광·인바운드) "실무"에 직접 닿아 있는가. quality_score와 별개로 판단.
  9~10: MICE/관광 산업·정책·행사·인재양성·산학협력에 직접 관련 (국내·지역 동향 포함)
  6~8: MICE/관광·이벤트 기획 업무에 응용되는 AI·기술이거나 간접 관련
  3~5: 일반 산업/기술 뉴스로 MICE·관광 접점이 약함
  1~2: MICE·관광과 무관한 순수 AI·IT·타산업 뉴스
        (반도체·칩·빅테크 투자·데이터센터·개발자 코딩 실무·해외 AI 규제/정치/보안 등)
- quality_score(종합): 위 relevance·specificity·practicality·source_quality 4항목을 종합한 글 완성도 점수
  (fit은 여기 포함하지 말 것 — 적합성은 별도 항목)
  9~10: 업계 핵심 인사이트, 구체적 수치/사례 풍부, 즉시 실행 가능한 시사점
  7~8: 관련성 높고 실용적, 부분적으로 구체적
  5~6: 일반적 내용, 시사점이 다소 추상적
  3~4: 관련성 낮거나 원문 접근 불가로 내용 빈약
  1~2: 카테고리와 무관하거나 정보 없음

레벨 판정 (체크리스트로 엄격히 판단):

Beginner — 다음 중 1개 이상 해당하면 Beginner:
  * 기술·서비스·제도를 처음 소개하는 입문성 기사
  * "~란 무엇인가", "~가 뜨는 이유" 등 개념·배경 설명 중심
  * 업계에 막 입문한 신입 직원이 맥락 파악을 위해 읽으면 좋을 내용
  * 특정 트렌드·기술이 왜 중요한지 배경부터 설명하는 기사
  * 실무 경험 없이도 전체 흐름을 이해할 수 있는 내용

Advanced — 다음 중 1개 이상 해당하면 Advanced:
  * 기술 아키텍처·알고리즘·정책 조항의 심층 분석
  * 시장 구조 변화·경쟁 구도·M&A·투자 전략 분석
  * 정량 데이터(수치, 통계)를 바탕으로 2차·3차 파급효과 분석
  * C레벨·투자자 의사결정에 직결되는 전략적 내용

Intermediate — 위 두 조건 모두 해당 없을 때

레벨별 작성 지침:
${levelSection}

문체 규칙: '~습니다/~입니다' 경어체로 작성하되, 딱딱하지 않고 읽기 편한 뉴스레터 톤으로 작성하세요. 신문체('~다', '~한다') 사용 금지.

business_domains(사업영역 분류): 시스템 지침(company_context)의 "7대 사업영역" 정의를 참고해,
이 기사의 핵심 주제가 아래 7개 중 어느 것과 직접 관련되는지 판단해 배열로 반환하세요.
  - 후보: ["스마트립","글로컬 관광","AI 관광","MICE Tech","ATT(관광 전시)","MEeT(의료 전시)","AXDX"]
  - 기사의 핵심 주제가 해당 영역일 때만 포함 — 스쳐 지나가는 언급이나 억지 연결은 제외
  - 시사점(implications)에서 사업 연결을 언급했다고 해서 자동으로 포함하지 말 것 — 별개 판단
  - 특히 "MICE Tech"는 오투미트(O2MEET)·LeadX 같은 기술/플랫폼 요소가 실제로 있을 때만 — 국제회의 유치,
    산학협력, 인력양성 등 기술과 무관한 일반 MICE 산업 뉴스는 절대 포함하지 말 것
  - 여러 영역에 핵심적으로 걸치면 복수 반환 가능, 어디에도 해당 없으면 빈 배열 [] (억지로 채우지 말 것)

다음 기사를 분석해 JSON으로만 응답하세요 (마크다운 없이):
{"quality_score":8,"quality_criteria":{"relevance":9,"specificity":8,"practicality":7,"source_quality":8,"fit":9},"level":"Intermediate","title":"제목(50자이내)","summary_short":"요약(120자이내)","content_long":"상세분석(4~6문장)","implications":"시사점(2~3문장)","business_domains":["AI 관광"]${multi ? ',"category":"MICE","category_reason":"카테고리 판단 근거 한 줄"' : ""}}

원문 URL: ${i.url}
${i.articleText.length > 50 ? `원문:\n${i.articleText}` : "(원문 접근 불가 — 제목과 URL을 바탕으로 작성해주세요)"}`;
}

export async function generateArticle(i: GenInput): Promise<{ ok: true; value: Generated } | { ok: false; error: string }> {
  const prompt = buildPrompt(i);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${i.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(i.companyContext?.trim() ? { systemInstruction: { parts: [{ text: i.companyContext.trim() }] } } : {}),
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        lastError = `Gemini HTTP ${res.status}`;
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1500); continue; }
        return { ok: false, error: lastError };
      }
      const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.business_domains)) parsed.business_domains = [];
      // 카테고리: 후보가 1개면 확정, 여러 개면 AI 응답을 검증(후보 밖이면 첫 후보로)
      const cats = i.categories;
      const aiCat = typeof parsed.category === "string" ? parsed.category.toUpperCase().trim() : "";
      parsed.category = cats.length === 1 ? cats[0] : (cats.includes(aiCat) ? aiCat : cats[0]);
      parsed.category_reason = cats.length > 1 && typeof parsed.category_reason === "string" ? parsed.category_reason.slice(0, 200) : null;
      return { ok: true, value: parsed as Generated };
    } catch (e) {
      lastError = (e as Error).message;
      if (attempt === 0) await sleep(1000);
    }
  }
  return { ok: false, error: lastError || "생성 실패" };
}
