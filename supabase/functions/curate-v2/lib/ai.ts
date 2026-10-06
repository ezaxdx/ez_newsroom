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
  calibrated?: boolean;                                  // true(기본): 점수 예시값 베끼기 방지 + 적합성·레벨 기준표. false 로 두면 v1 프롬프트 (quality_thresholds.calibrated)
  levelExamples?: { title: string; level: string }[];    // 관리자가 직접 고친 레벨 사례 — 비슷한 기사 판정에 참고
}
export interface Generated {
  title: string;
  summary_short: string;
  content_long: string;
  implications: string;
  level: string;
  level_axes?: { concept: number; practical: number; strategic: number };
  fit_reason?: string;
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

export const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;

/** 적합성 판단 예시 — 관리자가 직접 판정한 사례(2026-10-06). 점수는 판정 단계(꼭 실음 9 / 대기열 5 / 싣지 않음 2)를 대표값으로 표시 */
export const FIT_ANCHORS: { title: string; fit: number }[] = [
  { title: "기업 AI 활용 격차 심화, 노동 시장 재편 가속화", fit: 9 },
  { title: "클로드 AI 활용 PPT 디자인 및 스킬 제작 4단계", fit: 9 },
  { title: "SK AX, 코딩 없는 AI 에이전트 개발 'AI 부트캠프 바이브' 출시", fit: 9 },
  { title: "네이버지도, 메타 AI 글래스 연동 음성 길안내", fit: 9 },
  { title: "KT, 금융·공공 AX 인사이트 리포트 발간", fit: 9 },
  { title: "경복대 소프트웨어융합과, AI 활용 캠퍼스 데이터 연구로 국제학술지 논문 6편 게재", fit: 9 },
  { title: "킨텍스, 말레이시아 PWCC '플래티넘' 획득… 해외 MICE 경쟁력 입증", fit: 9 },
  { title: "한화시스템, '우주 AI 솔루션' 해외 첫 공개", fit: 5 },
  { title: "CJ온스타일, 킨텍스 공동 주최 스포츠 페스티벌 티켓 단독 판매", fit: 5 },
  { title: "창원대 남해캠퍼스, 제주항공서 실무 체험", fit: 2 },
  { title: "전북대, THE 세계대학평가 600위권 진입", fit: 2 },
  { title: "2026 국정감사, 충청 U대회 재원 확보가 주요 쟁점으로", fit: 2 },
];

/**
 * 적합성(fit) 기준표 — 판정 전용 호출(judgeFit)에서 사용.
 * 기사 작성 호출에는 넣지 않음: 작성 호출은 시스템 지침(회사 소개)이 "사업과 연결해서 분석하라"고 시키기 때문에
 * AI가 어떤 기사든 "이즈피엠피 AXDX 사업과 연결된다"고 합리화해서 적합성을 후하게 주는 문제가 확인됨 (판정 12건 중 4건 오판).
 */
export function fitRubricText(fitAnchors: { title: string; fit: number }[] = FIT_ANCHORS): string {
  const anchors = fitAnchors.map((a) => `  · "${a.title}" → fit ${a.fit}`).join("\n");
  return `fit(적합성) 기준 — 이 뉴스룸(MICE·관광·AI 업계 실무자 대상)에 실을 가치가 있는가. 기사 소재가 아니라 "독자 실무와의 접점"으로 판단하세요.
  판정 방법: 먼저 fit_reason 에 "이 기사가 독자(MICE·관광·AI 실무자)의 어떤 업무와 닿는지"를 한 줄로 쓰고(닿는 업무가 없으면 "없음"), 그에 맞춰 fit 점수를 정하세요. 업무와의 연결이 한 줄로 설명되지 않거나 억지스러우면 5점 이하입니다. 기사에 "AI"나 "관광" 단어가 있다는 것만으로 높은 점수를 주지 마세요. 우리 회사 사업과 연결 지으려 애쓰지 말고, 독자에게 유용한지만 보세요.
  7~10 (꼭 실음):
    · MICE (8~10): 산업·정책·행사 유치/개최/운영, 전시장·시설, 해외 진출·인증·협력
    · 관광 (8~10): 산업·정책·지역관광·스마트관광·인바운드
    · 이즈피엠피(EZPMP) 소식 (8~10)
    · AI·AX·DX 기사는 우선순위로 나눕니다:
      - 1순위 (9~10): MICE·관광·지역·행사 등 우리 사업영역에 AI를 적용한 소식 (관광 챗봇·AI 안내·추천, 행사 운영 자동화, 지자체 스마트관광 AI 도입, AI를 활용한 관광·MICE·지역 연구·사업)
      - 2순위 (7~8): 지금 화제인 AI 활용 이슈 — AI 기획·디자인·영상, 업무 자동화, AI 에이전트, 생산성 도구, 일상 AI 서비스, 기업·기관의 AX 도입 사례·리포트·가이드 (금융·공공 등 특정 산업을 대상으로 해도 포함)
  5~6 (대기열 — 사람이 검토):
    · AI 3순위: 순수 AI 업데이트 소식 — 모델·서비스 출시, 버전 업데이트, 특정 산업 전용(우주·방산·의료·금융·제조·반도체 등) AI 기술·제품 발표처럼 그 산업 종사자가 아니면 업무에 쓸 수 없는 소식 (AX 도입 전략·리포트는 해당하지 않음)
    · 소비자 대상 이벤트·티켓 판매·프로모션 등 행사 마케팅성 소식
  1~4 (싣지 않음):
    · 대학·교육기관 소식(평가·순위·학과 개편·실습·체험·인증 획득) — AI 활용 연구가 핵심이거나 MICE·관광 산업 인재양성 사업이 아닌 한 해당
    · 기사의 주제가 국정감사·정치·예산 논쟁·행정 이슈이면, 그 안에 MICE·관광 소재(행사 재원 등)가 섞여 있어도 해당 — 행사·시설 운영 실무 정보가 기사의 핵심이 아닌 한
    · 특정 지자체의 일반 소식 등 MICE·관광·AI 업무 활용과 접점이 없거나 약한 것
  관리자가 직접 판정한 사례 (비슷한 기사는 이 판정을 따르세요):
${anchors}`;
}

/** 7대 사업영역 기준 이름 — 화면 집계(DOMAINS)와 같은 표기. 저장할 때 이 이름으로 통일 */
export const DOMAIN_NAMES = ["스마트립", "글로컬 관광", "AI 관광", "MICE Tech", "ATT(관광 전시)", "MEeT(의료 전시)", "AXDX"] as const;
/** AI가 변형해서 쓴 이름 → 기준 이름 (회사 소개 문서의 표기 "ATT(All That Travel)" 등이 섞여 들어옴) */
export function canonicalDomain(name: string): string | null {
  const n = (name ?? "").replace(/\s+/g, "").toLowerCase();
  if (n.startsWith("att")) return "ATT(관광 전시)";
  if (n.startsWith("meet")) return "MEeT(의료 전시)";
  return DOMAIN_NAMES.find((d) => d.replace(/\s+/g, "").toLowerCase() === n) ?? null;
}

const DOMAIN_DEFS = `① 스마트립: 지역 관광 자원과 사용자 데이터를 연결해 여행 전·중·후 경험을 개인화하는 스마트 관광 서비스 (스마트 관광, 관광 DX, 맞춤형 여행, 체류형 관광, 로컬 콘텐츠, 관광 데이터)
② 글로컬 관광: 지역 고유 콘텐츠를 글로벌 관광객이 경험할 수 있게 재구성해 지역성과 국제 경쟁력을 함께 강화 (글로컬 관광, K-관광, 다국어 관광, 지역 브랜딩, 국제행사 연계, 인바운드)
③ AI 관광: 관광객의 질문·선호·위치·행동 데이터 기반의 맞춤 안내·추천·운영 지원 지능형 관광 서비스 (AI 관광, 관광 챗봇, 개인화 추천, 생성형 AI, 관광 자동화, 다국어 안내)
④ MICE Tech: MICE 산업 전반이 아니라, 행사 기획·등록·매칭·전시·현장 운영·성과 분석을 플랫폼과 AI 기술로 "실제로 연결·자동화"하는 것 자체 (O2MEET, LeadX, 행사 자동화, 전시 DX, 하이브리드 행사, 비즈니스 매칭). 국제회의 유치·산학협력·인력양성·지역 경제효과처럼 기술·플랫폼 요소가 없는 일반 MICE 뉴스는 해당 없음
⑤ ATT(관광 전시): 관광 산업의 다양한 주체와 콘텐츠를 연결해 관광 비즈니스·트렌드·기술을 종합적으로 선보이는 관광 행사·브랜드 (All That Travel, 관광 박람회, 관광 B2B, 지역 관광 홍보)
⑥ MEeT(의료 전시): 의료와 첨단기술, 글로벌 비즈니스 교류를 연결하는 의료 기술·산업 행사 및 플랫폼 (의료기술, 디지털헬스, 의료기기, 헬스케어, 의료 컨퍼런스)
⑦ AXDX: 이즈피엠피 사내 AI 전환을 추진하는 영역. AI 산업 전반의 기술·서비스·산업 적용 동향(외부 일반 AI 뉴스 포함)도 여기에 해당 (인공지능, 생성형 AI, AI 에이전트, AI 도입, 업무 자동화, 디지털 전환)`;

/**
 * 판정 호출 설정. thinking=false 면 AI의 긴 사고 단계를 끔(thinkingBudget 0) → 응답이 몇 배 빨라짐.
 * 관리자 판정 기준으로 시험한 결과가 호출마다 달라서 따로 정함:
 *  · 사업영역: 끄면 오히려 정답에 가까워짐 (일치 3/11 → 5/11, 3개 이상 태그 8건 → 1건) → 끔
 *  · 적합성:   끄면 대기열 기사가 "싣지 않음"으로 떨어지는 등 경계 판정이 나빠짐 (11/12 → 10/12) → 켬(기본)
 */
const judgeGenConfig = (thinking: boolean) => ({
  temperature: 0,
  responseMimeType: "application/json",
  ...(thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
});

export type DomainJudgement = { ok: true; domains: string[]; evidence: Record<string, string> } | { ok: false; error: string };
/**
 * 사업영역 분류 전용 호출 — 기사 작성과 분리.
 * 작성 호출에서는 시사점(사업 연결 서술)을 쓴 직후에 영역을 고르게 되고 시스템 지침도 "연결 우선"이라 과다 태깅이 생김(평균 1.64개, 3개 이상 9%).
 * 여기서는 원문 본문과 영역 정의, 관리자 보정 사례만 보고 "기사의 핵심 주제가 직접 해당하는 영역"만 고름.
 */
/**
 * 회사 소개 문서(company_context)에서 "7대 사업영역 정의 + 분류 판단 기준" 부분만 잘라냄 — 판정 호출이 이 문서를 그대로 읽으므로
 * 설정 화면에서 문서를 고치면 판정에도 바로 반영됨 (기준이 두 군데로 갈라지지 않게). 구분 표시를 못 찾으면 null → 내장 정의 사용
 */
export function extractDomainSection(ctx: string | null | undefined): string | null {
  const c = ctx ?? "";
  const a = c.indexOf("【7대 사업영역】");
  if (a < 0) return null;
  const b = c.indexOf("【시사점 작성 기준】", a);
  const s = c.slice(a, b > a ? b : undefined).replace(/[─━]{3,}/g, "").trim();
  return s.length > 300 ? s : null;
}

export async function judgeDomains(i: { apiKey: string; title: string; text: string; examples?: { title: string; business_domains: string[] }[]; definitions?: string | null }): Promise<DomainJudgement> {
  const ex = (i.examples ?? []).slice(0, 30).map((e) => `  · "${e.title}" → ${JSON.stringify(e.business_domains)}`).join("\n");
  const fromDoc = !!i.definitions;
  const prompt = `당신은 MICE·관광·AI 기업 이즈피엠피의 사업 분류 담당자입니다. 아래 기사의 "핵심 주제"가 직접 해당하는 사업영역을 고르세요.

${fromDoc ? i.definitions : `사업영역 정의:\n${DOMAIN_DEFS}`}

분류 원칙:
- 기사의 핵심 주제가 그 영역의 사업 내용과 직접 일치할 때만 고릅니다. 스쳐 지나가는 언급, 키워드 일치, 억지 연결은 제외하세요. 우리 회사 사업과 연결 지으려 애쓰지 마세요.
${fromDoc ? "" : `- 영역별 핵심 기준 (관리자가 직접 고친 사례에서 확인된 원칙):
  · AXDX: AI 기술·서비스·산업 적용 동향이 기사의 핵심이면 기본적으로 AXDX "만" 붙입니다. 기사에 관광·행사 소재가 나와도 그것이 AI 소식의 배경일 뿐이면 다른 영역은 붙이지 않습니다.
  · AI 관광: 관광객을 대상으로 한 AI 서비스(챗봇·추천·안내·통번역)나 관광 분야의 AI 도입 자체가 기사의 핵심일 때만 추가합니다.
  · 스마트립: 관광객 개인화 서비스·관광 DX·관광 데이터 서비스가 핵심일 때만 붙입니다. 일반 관광 행사·축제·정책·시설 소식이나 "체류형 관광"·"스마트 예약" 같은 한 줄 언급만으로는 해당하지 않습니다.
  · 글로컬 관광: 지역 고유 콘텐츠의 글로벌화·K-관광·인바운드·다국어 관광이 핵심일 때만 붙입니다. 행사 유치 소식 자체는 해당하지 않습니다.
`}- 대부분의 기사는 0~2개입니다. 3개 이상은 핵심 내용이 세 영역에 모두 걸칠 때만 허용됩니다. 어디에도 해당하지 않으면 빈 배열입니다.
- 고른 영역마다 근거를 기사 내용으로 한 줄 쓰세요. 근거가 단어 일치뿐이거나 설명이 억지스러우면 그 영역은 빼세요.
${ex ? `\n관리자가 직접 검수한 사례 (비슷한 기사는 이 판단을 따르세요):\n${ex}\n` : ""}
JSON으로만 응답하세요: {"domains":[{"name":"영역 이름","evidence":"근거 한 줄"}]}  (해당 없으면 {"domains":[]})
영역 이름은 다음 중에서만: ${DOMAIN_NAMES.join(", ")}

기사 제목: ${i.title}
기사 내용:
${i.text.slice(0, 5000)}`;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${i.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: judgeGenConfig(false) }),
        signal: AbortSignal.timeout(25000),
      });
      const json = await res.json();
      if (!res.ok) {
        lastError = `Gemini HTTP ${res.status}`;
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1200); continue; }
        return { ok: false, error: lastError };
      }
      const parts: Array<{ text?: string; thought?: boolean }> = json.candidates?.[0]?.content?.parts ?? [];
      const raw = (parts.find((p) => !p.thought && typeof p.text === "string")?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      const domains: string[] = []; const evidence: Record<string, string> = {};
      for (const d of Array.isArray(parsed.domains) ? parsed.domains : []) {
        const name = canonicalDomain(typeof d === "string" ? d : d?.name);
        if (name && !domains.includes(name)) { domains.push(name); evidence[name] = String(d?.evidence ?? "").slice(0, 160); }
      }
      return { ok: true, domains, evidence };
    } catch (e) {
      lastError = (e as Error).message;
      if (attempt === 0) await sleep(800);
    }
  }
  return { ok: false, error: lastError || "사업영역 판정 실패" };
}

export type FitJudgement = { ok: true; fit: number; reason: string } | { ok: false; error: string };
/** 적합성 판정 전용 짧은 호출 — 회사 소개(시스템 지침) 없이, 편집장 입장에서 "이 뉴스룸에 실을 기사인가"만 판단 */
export async function judgeFit(i: { apiKey: string; title: string; text: string; category: string; fitAnchors?: { title: string; fit: number }[] }): Promise<FitJudgement> {
  const prompt = `당신은 MICE·관광·AI 업계 실무자를 위한 뉴스룸의 편집장입니다. 아래 기사를 이 뉴스룸에 실을지 판정하세요.

${fitRubricText(i.fitAnchors)}

JSON으로만 응답하세요: {"fit_reason":"독자 업무와의 접점 한 줄(없으면 없음)","fit":(1~10 정수)}

기사 제목: ${i.title}
분류: ${i.category}
기사 내용:
${i.text.slice(0, 3500)}`;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${i.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: judgeGenConfig(true) }),
        signal: AbortSignal.timeout(25000),
      });
      const json = await res.json();
      if (!res.ok) {
        lastError = `Gemini HTTP ${res.status}`;
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1200); continue; }
        return { ok: false, error: lastError };
      }
      const parts: Array<{ text?: string; thought?: boolean }> = json.candidates?.[0]?.content?.parts ?? [];
      const raw = (parts.find((p) => !p.thought && typeof p.text === "string")?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      const fit = Math.round(Number(parsed.fit));
      if (!Number.isFinite(fit) || fit < 1 || fit > 10) throw new Error("fit 값이 올바르지 않음");
      return { ok: true, fit, reason: String(parsed.fit_reason ?? "").slice(0, 200) };
    } catch (e) {
      lastError = (e as Error).message;
      if (attempt === 0) await sleep(800);
    }
  }
  return { ok: false, error: lastError || "적합성 판정 실패" };
}

/** 점수·레벨 기준표 (calibrated=true, 기본). 예시 숫자를 베끼지 않도록 JSON 은 형식만 안내하고 기준은 여기서 글로 줌 */
function scoringAndLevelV2(levelExamples: { title: string; level: string }[] | undefined, levelSection: string): string {
  const lvEx = (levelExamples ?? []).slice(0, 30).map((e) => `  · "${e.title}" → ${e.level}`).join("\n");
  return `퀄리티 점수 기준 (각 항목 1~10점):
- relevance(카테고리 관련성): 카테고리·페르소나·키워드와의 일치도
- specificity(구체성): 수치·사례·데이터의 풍부함
- practicality(실용성): 즉시 활용 가능한 시사점 여부
- source_quality(원문품질): 원문 접근 가능성 및 내용 충실도
- fit: 이 값은 별도 호출에서 판정하므로 1로 두세요 (평가하지 마세요)
- quality_score(종합): 위 4항목을 종합한 글 완성도 점수
  대부분의 일반 기사는 5~7점입니다. 8점 이상은 구체적 수치·사례가 풍부하고 실무에 바로 쓸 수 있는 뚜렷하게 우수한 기사에만 주세요. 9~10점은 매우 드뭅니다.

레벨 판정 — 기사의 "성격"으로 정합니다 (글을 쓰는 방식이 아니라 원문이 독자에게 요구하는 사전 지식 수준).
먼저 원문의 성격을 3가지 비중으로 평가하세요 (각 0~3점, level_axes):
  · concept: 용어·제도·기술이 무엇인지, 왜 중요한지 풀어서 설명하는 비중
  · practical: 특정 행사·사업·사례의 일정·규모·운영방식·참가/적용 방법 등 담당자가 바로 활용할 사실의 비중
  · strategic: 시장 데이터·통계 비교·정책 조항 해석·경쟁/투자 구도·파급효과 분석의 비중
세 점수를 종합해 판정하세요 (한 가지 신호만으로 단정하지 말 것):
  · Beginner: concept가 가장 높고 strategic는 낮음. 개념을 소개·해설하는 글. 행사·사업 소식이나 보도자료는 개념 설명이 없으면 Beginner가 아님.
  · Intermediate: practical이 가장 높음. 행사·사업 소식, 사례, 제도 시행 안내 등 업계 경험자가 사실을 확인하고 업무에 참고하는 글. 뉴스의 대부분이 여기에 해당함.
  · Advanced: strategic가 높고 수치·근거를 바탕으로 구조 변화나 의사결정 시사점을 논함. 의견·제언이 있어도 수치·근거 없이 선언적이면 Advanced가 아님.${lvEx ? `\n  관리자가 직접 고친 레벨 사례 (비슷한 기사는 이 판단을 따르세요):\n${lvEx}` : ""}

레벨별 작성 지침 (판정한 레벨의 지침으로 작성):
${levelSection}`;
}

/** v1 방식(calibrated=false)에서만 사용: 기사 작성 호출이 사업영역도 같이 분류. 기본(분리 판정)에서는 작성 호출에서 영역 분류를 아예 뺌 */
const V1_DOMAIN_PARAGRAPH = `business_domains(사업영역 분류): 시스템 지침(company_context)의 "7대 사업영역" 정의를 참고해,
이 기사의 핵심 주제가 아래 7개 중 어느 것과 직접 관련되는지 판단해 배열로 반환하세요.
  - 후보: ["스마트립","글로컬 관광","AI 관광","MICE Tech","ATT(관광 전시)","MEeT(의료 전시)","AXDX"]
  - 기사의 핵심 주제가 해당 영역일 때만 포함 — 스쳐 지나가는 언급이나 억지 연결은 제외
  - 시사점(implications)에서 사업 연결을 언급했다고 해서 자동으로 포함하지 말 것 — 별개 판단
  - 특히 "MICE Tech"는 오투미트(O2MEET)·LeadX 같은 기술/플랫폼 요소가 실제로 있을 때만 — 국제회의 유치,
    산학협력, 인력양성 등 기술과 무관한 일반 MICE 산업 뉴스는 절대 포함하지 말 것
  - 여러 영역에 핵심적으로 걸치면 복수 반환 가능, 어디에도 해당 없으면 빈 배열 [] (억지로 채우지 말 것)
`;

const V1_SCORING_AND_LEVEL = (levelSection: string) => `퀄리티 점수 기준 (각 항목 1~10점, quality_score는 종합 판단):
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
${levelSection}`;

function levelBlock(cat: string, lp: Record<string, Record<string, string>>): string {
  const l = lp[cat] ?? {};
  return `[Beginner] ${l["Beginner"] ?? "쉽고 명확하게 작성하세요."}
[Intermediate] ${l["Intermediate"] ?? "실무 담당자 관점에서 작성하세요."}
[Advanced] ${l["Advanced"] ?? "전략적 심층 분석으로 작성하세요."}`;
}

function defaultSetting(cat: string): CatSetting {
  return { audience: "MICE·관광 업계 종사자", persona: `당신은 ${cat} 전문 에디터입니다. 업계 종사자 관점에서 핵심 시사점을 분석합니다.`, keywords: [] };
}

/**
 * 응답 JSON 형식 안내.
 * 기본(calibrated=false)은 v1과 동일 — 예시값(품질 8, 적합 9)이 들어 있어 AI가 그 숫자를 거의 그대로 베끼는 문제가 있음
 * (운영 기사 682건 중 품질 8~9점이 99%, 적합성 4점 이하 0건 → 적합성 관문이 작동하지 않음).
 * calibrated=true 는 예시값 대신 형식만 안내하고 점수 분포 가이드를 줌.
 */
function jsonSection(multi: boolean, calibrated: boolean): string {
  const catPart = multi ? ',"category":"후보 중 하나","category_reason":"카테고리 판단 근거 한 줄"' : "";
  if (!calibrated) {
    return `다음 기사를 분석해 JSON으로만 응답하세요 (마크다운 없이):
{"quality_score":8,"quality_criteria":{"relevance":9,"specificity":8,"practicality":7,"source_quality":8,"fit":9},"level":"Intermediate","title":"제목(50자이내)","summary_short":"요약(120자이내)","content_long":"상세분석(4~6문장)","implications":"시사점(2~3문장)","business_domains":["AI 관광"]${catPart.replace('"후보 중 하나"', '"MICE"')}}`;
  }
  return `다음 기사를 분석해 JSON으로만 응답하세요 (마크다운 없이).
아래는 형식 설명이며, 숫자 자리에는 이 기사를 직접 평가한 값을 넣으세요 (예시값을 따라 쓰지 마세요).
{"quality_score":(1~10 정수),"quality_criteria":{"relevance":(1~10),"specificity":(1~10),"practicality":(1~10),"source_quality":(1~10),"fit":1},"level_axes":{"concept":(0~3),"practical":(0~3),"strategic":(0~3)},"level":"Beginner|Intermediate|Advanced 중 하나","title":"제목(50자이내)","summary_short":"요약(120자이내)","content_long":"상세분석(4~6문장)","implications":"시사점(2~3문장)"${catPart}}

점수는 위 기준표에 따라 기사마다 직접 평가하세요. 모든 기사에 같은 점수를 주지 마세요.`;
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
${i.calibrated === false ? V1_SCORING_AND_LEVEL(levelSection) : scoringAndLevelV2(i.levelExamples, levelSection)}

문체 규칙: '~습니다/~입니다' 경어체로 작성하되, 딱딱하지 않고 읽기 편한 뉴스레터 톤으로 작성하세요. 신문체('~다', '~한다') 사용 금지.

${i.calibrated === false ? V1_DOMAIN_PARAGRAPH + "\n" : ""}${jsonSection(multi, !!i.calibrated)}

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
      if (!(LEVELS as readonly string[]).includes(parsed.level)) parsed.level = "Intermediate";
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


