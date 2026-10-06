// EventsClient와 공유하는 EZPMP 행사 스코어링 로직

// ── HIGH MATCH (+15): MICE 핵심 타입 + EZPMP 주력 분야 ──────────────
export const EZPMP_HIGH_MATCH: string[] = [
  // MICE 핵심 행사 타입
  "전시", "박람회", "엑스포", "expo",
  "국제회의", "국제행사", "컨벤션", "MICE", "마이스",
  "summit", "forum", "포럼", "컨퍼런스", "conference",
  "전시홍보관", "홍보관", "기업회의", "비즈니스",

  // 관광 (EZPMP 15건)
  "관광", "스마트관광", "tourism", "travel", "여행",

  // 에너지·환경 (EZPMP 14건 + COP/UNFCCC 다수)
  "환경", "기후", "에너지", "탄소", "순환경제", "그린", "태양광",
  "신재생", "수소", "전력", "COP", "UNFCCC",

  // 문화·콘텐츠 (EZPMP 15건)
  "콘텐츠", "content", "K-콘텐츠", "문화", "디자인",

  // AI·스마트·디지털 (국제회의·산업전시 맥락)
  "AI", "인공지능", "스마트", "디지털", "ICT", "정보통신", "빅데이터", "데이터",

  // 박람회·전시 일반 (이름에 박람회 없어도 엑스포·팜·쇼 포함)
  "팜", "K-팜", "케이팜", "쇼",

  // 정부·공공 행사
  "정부", "공공", "행정", "혁신", "국제",
];

// ── MEDIUM MATCH (+5): 관련 있지만 주력 아닌 분야 ─────────────────────
export const EZPMP_MEDIUM_MATCH: string[] = [
  "산업", "무역", "무역박람회",
  "스타트업", "startup", "벤처", "창업",
  "농업", "식품", "농축산", "수산", "해양",
  "학술", "연구", "과학",
  "안보", "방산", "국방",
  "금융", "경제",
  "모빌리티", "자동차", "항공", "우주",
  "의료", "헬스케어", "바이오",
  "방송", "미디어",
];

// ── 전국 주요 컨벤션센터 (+8) ─────────────────────────────────────────
export const PREFERRED_VENUES = [
  "코엑스", "킨텍스", "벡스코", "BEXCO",
  "김대중컨벤션센터", "창원컨벤션센터", "대전컨벤션센터",
  "SETEC", "세텍", "aT센터", "AT센터",
  "송도컨벤시아", "수원컨벤션", "경주화백",
  "ICC JEJU", "제주국제컨벤션",
  "동대문디자인플라자", "DDP",
  "군산새만금", "엑스코", "EXCO",
];

export const EZPMP_PARTNERS: string[] = [
  "행정안전부", "환경부", "문화체육관광부", "산업통상자원부", "과학기술정보통신부",
  "해양수산부", "외교부", "국토교통부", "중소벤처기업부", "농림축산식품부", "국방부",
  "한국콘텐츠진흥원", "KOCCA",
  "한국관광공사", "KTO",
  "한국무역협회", "KITA",
  "대한무역투자진흥공사", "KOTRA",
  "한국국제협력단", "KOICA",
  "한국에너지공단",
  "한국환경산업기술원", "KEITI",
  "한국환경연구원", "KEI",
  "한국농수산식품유통공사", "aT",
  "한국수자원공사", "K-water",
  "한국전력공사", "KEPCO",
  "한국국토정보공사", "LX",
  "한국도로공사", "KEC",
  "한국토지주택공사", "LH",
  "한국주택협회",
  "한국개발연구원", "KDI",
  "한국산업기술진흥협회", "KOITA",
  "한국지능정보사회진흥원", "NIA",
  "한국생산기술연구원", "KITECH",
  "한국과학기술연구원", "KIST",
  "한국해양과학기술원", "KIOST",
  "한국공예디자인문화진흥원", "KCDF",
  "한국농촌경제연구원", "KREI",
  "한국벤처캐피탈협회", "KVCA",
  "벤처기업협회",
  "중소벤처기업진흥공단", "KOSME",
  "국토교통과학기술진흥원",
  "공간정보산업진흥원", "SpaceN",
  "한국산업연합포럼",
  "대한상공회의소", "KCCI",
  "국가과학기술연구회", "NST",
  "광주비엔날레",
  "서울경제진흥원", "인천관광공사",
  "한국수산회",
  "한국산업은행", "KDB",
  "2018평창기념재단", "평창기념재단",
  "경상북도경제진흥원",
  "킨텍스", "KINTEX",
  "디지털플랫폼정부위원회",
  "탄소중립녹색성장위원회",
  "한국자동차모빌리티산업협회", "KAMA",
  "한국장학재단", "KOSAF",
  "한국수산회",
  "농촌진흥청", "RDA",
  "금융위원회",
  "국무조정실",
  "한화에어로스페이스", "한화넥스트",
  "제일기획",
];

export function isEzpmpPartner(organizer: string | null | undefined): boolean {
  if (!organizer) return false;
  // 쉼표·슬래시로 구분된 복수 기관을 각각 개별 매칭
  const orgs = organizer
    .replace(/（[^）]*）/g, "")
    .split(/[,\/]/)
    .map((o) => o.replace(/\([^)]*\)/g, "").trim().toLowerCase())
    .filter(Boolean);
  return orgs.some((orgBase) =>
    EZPMP_PARTNERS.some((p) => {
      if (p.length < 2) return false;
      const pl = p.toLowerCase();
      return orgBase === pl || orgBase.includes(pl) || pl.includes(orgBase);
    })
  );
}

export type EventForScore = {
  event_name: string;
  event_name_en?: string | null;
  category?: string | null;
  industry?: string | null;
  organizer?: string | null;
  venue: string;
  start_date: string;
};

// ══════════════════════════════════════════════════════════════════════
// 행사 점수 산식 (2026-10 개편)
//   점수 = 키워드 점수(이름·영문명·분야만, 희소성 가중, 상한) + 주최 점수 + 수행실적 발주처 점수 + 분류 보정 + 날짜 근접도
//   · 키워드: 흔한 단어("국제", "박람회", "산업"…)는 가중을 낮추고 드문 단어는 높임 (IDF). 긴 세부품목(industry)은 보지 않음
//   · 주최: 공공·기관 / 파트너 / 동종 업계 / 장소 운영사 / PEO 중 가장 큰 쪽 하나만 적용 (겹쳐도 부풀지 않음)
//   · 수행실적 발주처: 회사 수행실적의 발주처·주최·주관과 같으면 별도 가산 (엑셀로 분기마다 갱신)
// ══════════════════════════════════════════════════════════════════════

export type OrgTier = "client" | "peer" | "venue" | "peo";

export type ScoreWeights = {
  kwHigh: number;        // 핵심 키워드 1개당 기본 가중 (× idf)
  kwMedium: number;      // 보조 키워드 1개당 기본 가중 (× idf)
  kwCap: number;         // 키워드 점수 합계 상한
  public: number;        // 공공·지자체·기관·협회 주최
  partner: number;       // EZPMP 파트너 기관 주최
  peer: number;          // 동종 업계 주최사
  venue: number;         // 장소 운영사 주최
  peo: number;           // PEO 계열(후순위)
  clientBase: number;    // 수행실적 발주처 일치 기본 가산
  clientPerHit: number;  // 수행실적 등장 횟수당 추가 (최대 3회까지)
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  kwHigh: 8, kwMedium: 3, kwCap: 70,
  public: 90, partner: 60, peer: 50, venue: 50, peo: 30,
  clientBase: 40, clientPerHit: 15,
};

export type ScoringContext = {
  idf?: Record<string, number>;                                // 키워드 → 희소성(IDF). 없으면 아래 기본값
  orgs?: { key: string; tier: OrgTier; hit?: number }[];       // 주최사 목록. 없으면 기본 목록
  weights?: Partial<ScoreWeights>;
};

// 행사 DB(공개 648건) 기준으로 계산한 기본 IDF — 서버에서는 실제 행사 목록으로 다시 계산해 덮어씀 (event-score-context.ts)
export const DEFAULT_IDF: Record<string, number> = {
  "전시":0.9,"박람회":1.9,"엑스포":2.7,"expo":2.9,"국제회의":6.5,"국제행사":6.5,"컨벤션":5.8,"mice":5.8,"마이스":5.8,"summit":6.5,"forum":6.5,"포럼":5.1,
  "컨퍼런스":3.7,"conference":4.9,"전시홍보관":6.5,"홍보관":6.5,"기업회의":6.5,"비즈니스":5.8,"관광":2.5,"스마트관광":6.5,"tourism":5.8,"travel":5.1,"여행":5.8,
  "환경":3.5,"기후":6.5,"에너지":3.3,"탄소":5.8,"순환경제":6.5,"그린":5.1,"태양광":5.8,"신재생":6.5,"수소":5.8,"전력":5.8,"cop":5.8,"unfccc":6.5,"콘텐츠":5.4,
  "content":6.5,"k-콘텐츠":6.5,"문화":3.3,"디자인":4.5,"ai":4,"인공지능":5.1,"스마트":3.8,"디지털":5.1,"ict":5.8,"정보통신":2.8,"빅데이터":5.8,"데이터":5.4,
  "팜":4.9,"k-팜":6.5,"케이팜":5.4,"쇼":2.2,"정부":5.4,"공공":3.4,"행정":6.5,"혁신":5.4,"국제":1.7,"산업":2,"무역":6.5,"무역박람회":6.5,"스타트업":5.8,"startup":6.5,
  "벤처":6.5,"창업":3.9,"농업":6.5,"식품":3.9,"농축산":6.5,"수산":5.4,"해양":4.9,"학술":4.7,"연구":5.4,"과학":5.4,"안보":6.5,"방산":5.8,"국방":3.3,"금융":3.5,
  "모빌리티":4.4,"자동차":5.8,"항공":4.7,"우주":4.9,"의료":3.5,"헬스케어":5.4,"바이오":4.2,"방송":2.8,"미디어":5.4,
};
const FALLBACK_IDF = 4;

// 기본 주최사 목록 (DB event_org_affinity 가 없을 때) — 08_event_scoring.sql 시드와 같은 값
export const DEFAULT_ORGS: { key: string; tier: OrgTier }[] = [
  ...["메쎄이상", "서울메쎄", "메세코리아", "인터컴", "이오컨벡스", "인세션", "한국mice협회", "엑스포럼"].map((key) => ({ key, tier: "peer" as const })),
  ...["코엑스", "킨텍스", "벡스코", "엑스코", "세텍", "at센터", "송도컨벤시아", "수원컨벤션센터", "김대중컨벤션센터", "창원컨벤션센터", "대전컨벤션센터", "제주국제컨벤션센터", "경주화백컨벤션센터"].map((key) => ({ key, tier: "venue" as const })),
  ...["동아전람", "미래전람", "경연전람", "한국국제전시", "한국이앤엑스", "인포더", "제일좋은전람", "메가쇼", "코아미"].map((key) => ({ key, tier: "peo" as const })),
];

export const ALL_SCORE_KEYWORDS: string[] = [...new Set([...EZPMP_HIGH_MATCH, ...EZPMP_MEDIUM_MATCH].map((k) => k.toLowerCase()))];

/** 기관명 정규화 — 소문자, (주)·주식회사·(사)·괄호·공백 제거 (수행실적 엑셀·DB 주최·주최사 목록이 같은 기준으로 비교되도록) */
export function orgKey(name: string | null | undefined): string {
  return (name ?? "").replace(/\([^)]*\)|（[^）]*）|주식회사|㈜|\(주\)|\(사\)|\(재\)|사단법인|재단법인/g, "").replace(/\s+/g, "").toLowerCase();
}
const orgParts = (organizer: string | null | undefined) =>
  (organizer ?? "").split(/[,\/、]/).map(orgKey).filter((s) => s.length >= 2);
const orgMatches = (part: string, key: string) =>
  part === key || (Math.min(part.length, key.length) >= 3 && (part.includes(key) || key.includes(part)));

// 공공·지자체·기관·협회형 주최 — 이즈픽(회사가 관여한 행사)의 12/13 이 이 유형이라 가장 강한 신호.
// 민간 전람사 이름("주식회사", "㈜", "(주)")이 붙은 곳은 제외
const PUBLIC_ORG = /(특별시|광역시|특별자치|도청|시청|군청|구청|정부|위원회|공사|공단|진흥원|진흥회|재단|연구원|연구소|협회|학회|협의회|조합|대학|부$|청$|원$|kotra|kocca|kepco)/i;
export function isPublicOrg(organizer: string | null | undefined): boolean {
  return (organizer ?? "").split(/[,\/]/).map((s) => s.trim()).filter(Boolean)
    .some((s) => PUBLIC_ORG.test(s.replace(/\(주\)|㈜|\(사\)|\(재\)/g, "")) && !/주식회사|㈜|\(주\)/.test(s));
}

// 영문 키워드는 단어 시작에서만(예: "AI"가 FAIR·Indian 안에서 걸리던 오탐 제거). 3글자 이하는 독립 단어일 때만, AIoT·AIX 같은 파생형은 예외 허용
export function kwMatch(text: string, kw: string): boolean {
  if (!/^[a-z0-9\-]+$/.test(kw)) return text.includes(kw);
  const re = kw.length <= 3
    ? new RegExp(`(^|[^a-z0-9])${kw}(?![a-z])|(^|[^a-z0-9])${kw}(ot|x)(?![a-z])`)
    : new RegExp(`(^|[^a-z0-9])${kw}`);
  return re.test(text);
}

export type ScoreBreakdown = { keyword: number; org: number; orgLabel: string | null; client: number; category: number; proximity: number; total: number; matched: string[] };

export function explainScore(event: EventForScore, today: Date, ctx: ScoringContext = {}): ScoreBreakdown {
  const w = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
  const idfOf = (kw: string) => ctx.idf?.[kw] ?? DEFAULT_IDF[kw] ?? FALLBACK_IDF;

  // ① 키워드 — 이름·영문명·분야만 (industry 의 긴 세부품목은 점수 부풀림의 원인이라 제외)
  const text = [event.event_name, event.event_name_en ?? "", event.category ?? ""].join(" ").toLowerCase();
  let keyword = 0;
  const matched: string[] = [];
  for (const kw of EZPMP_HIGH_MATCH) { const k = kw.toLowerCase(); if (kwMatch(text, k)) { keyword += w.kwHigh * idfOf(k); matched.push(kw); } }
  for (const kw of EZPMP_MEDIUM_MATCH) { const k = kw.toLowerCase(); if (kwMatch(text, k)) { keyword += w.kwMedium * idfOf(k); matched.push(kw); } }
  keyword = Math.min(Math.round(keyword), w.kwCap);

  // ② 주최 — 가장 큰 유형 하나만
  const parts = orgParts(event.organizer);
  const orgList: { key: string; tier: OrgTier; hit?: number }[] = ctx.orgs ?? DEFAULT_ORGS;
  let org = 0; let orgLabel: string | null = null;
  const take = (v: number, label: string) => { if (v > org) { org = v; orgLabel = label; } };
  if (isPublicOrg(event.organizer)) take(w.public, "공공·기관");
  if (isEzpmpPartner(event.organizer)) take(w.partner, "파트너 기관");
  for (const o of orgList) {
    if (o.tier === "client") continue;
    if (parts.some((p) => orgMatches(p, o.key))) take(o.tier === "peer" ? w.peer : o.tier === "venue" ? w.venue : w.peo, o.tier === "peer" ? "동종 업계" : o.tier === "venue" ? "장소 운영사" : "PEO");
  }

  // ③ 수행실적 발주처 일치 — 주최 점수와 별개로 더함
  let clientHit = 0;
  for (const o of orgList) if (o.tier === "client" && parts.some((p) => orgMatches(p, o.key))) clientHit = Math.max(clientHit, o.hit ?? 1);
  const client = clientHit > 0 ? w.clientBase + w.clientPerHit * Math.min(clientHit, 3) : 0;

  // ④ 분류 보정
  let category = 0;
  if (event.category === "전시") category += 10;
  if (event.category === "회의") category += 8;

  // ⑤ 날짜 근접도 (KST 기준): 7일·14일·30일·그 이후
  const todayKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayDateStr = todayKST.toISOString().split("T")[0];
  const daysUntil = (new Date(event.start_date).getTime() - new Date(todayDateStr).getTime()) / (1000 * 60 * 60 * 24);
  let proximity = 0;
  if (daysUntil >= 0 && daysUntil < 7) proximity = 50;
  else if (daysUntil >= 7 && daysUntil < 14) proximity = 40;
  else if (daysUntil >= 14 && daysUntil <= 30) proximity = 20;
  else if (daysUntil > 30) proximity = 5;

  return { keyword, org, orgLabel, client, category, proximity, total: keyword + org + client + category + proximity, matched };
}

export function scoreEvent(event: EventForScore, today: Date, ctx: ScoringContext = {}): number {
  return explainScore(event, today, ctx).total;
}

/** EZPMP 픽 기준: 최소 스코어 이상 + 스코어 내림차순 top N */
export const EZPMP_PICK_MIN_SCORE = 15;

/** 픽 슬롯 수 — 홈 캘린더·행사 캘린더 공통 */
export const EZPMP_PICK_SLOTS = 8;

export type PickableEvent = EventForScore & { id: string; is_ezpmp_pick?: boolean };

/**
 * 이즈픽 선정 (홈·행사 캘린더 공통 로직)
 * 어드민 ⭐ 픽 최우선, 남는 자리는 자동 점수(EZPMP_PICK_MIN_SCORE 이상) 상위로 채움
 */
export function selectEzpmpPickIds(
  events: PickableEvent[],
  today: Date,
  slots: number = EZPMP_PICK_SLOTS,
  ctx: ScoringContext = {}
): Set<string> {
  const pickIds = new Set(events.filter((e) => e.is_ezpmp_pick).map((e) => e.id));
  const autoSlots = Math.max(0, slots - pickIds.size);
  events
    .filter((e) => !pickIds.has(e.id))
    .map((e) => ({ id: e.id, score: scoreEvent(e, today, ctx) }))
    .filter(({ score }) => score >= EZPMP_PICK_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, autoSlots)
    .forEach(({ id }) => pickIds.add(id));
  return pickIds;
}

/** Weekly Event List 최소 스코어 - 총회·이사회 등 무관 행사 제거 */
export const WEEKLY_LIST_MIN_SCORE = 13;

/** Weekly Event List 제외 키워드 (행사명에 포함되면 제외) */
export const WEEKLY_EXCLUDE_KEYWORDS = [
  "정기총회", "임시총회", "이사회", "간담회", "위원회",
  "강의", "교육", "워크숍", "workshop", "세미나", "seminar",
  "출산", "육아", "임신", "영유아", "맘", "베이비", "baby", "키즈", "kids",
  "키즈카페", "놀이터", "놀이공간", "놀이시설", "놀이구조물", "실내놀이",
];
