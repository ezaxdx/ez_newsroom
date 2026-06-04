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
  "AI", "인공지능", "스마트", "디지털", "ICT", "정보통신",

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
  const orgBase = organizer
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .trim()
    .toLowerCase();
  return EZPMP_PARTNERS.some((p) => {
    if (p.length < 2) return false;
    const pl = p.toLowerCase();
    return (
      orgBase === pl ||
      orgBase.startsWith(pl + " ") ||
      orgBase.endsWith(" " + pl) ||
      (orgBase.includes(pl) && pl.length / orgBase.length >= 0.8)
    );
  });
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

export function scoreEvent(event: EventForScore, today: Date): number {
  const searchText = [
    event.event_name,
    event.event_name_en ?? "",
    event.industry ?? "",
    event.category ?? "",
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;

  for (const kw of EZPMP_HIGH_MATCH) {
    if (searchText.includes(kw.toLowerCase())) score += 15;
  }
  for (const kw of EZPMP_MEDIUM_MATCH) {
    if (searchText.includes(kw.toLowerCase())) score += 5;
  }

  if (event.category === "전시") score += 10;
  if (event.category === "회의") score += 8;

  if (PREFERRED_VENUES.includes(event.venue)) score += 8;

  if (isEzpmpPartner(event.organizer)) score += 30;

  const startMs  = new Date(event.start_date).getTime();
  const daysUntil = (startMs - today.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntil >= 0  && daysUntil < 7)        score += 50; // 이번 주
  else if (daysUntil >= 7 && daysUntil <= 30)  score += 40; // 이번 달
  else if (daysUntil > 30 && daysUntil <= 60)  score += 10; // 다음 달
  else if (daysUntil > 60 && daysUntil <= 90)  score += 5;  // 2달 후

  return score;
}

/** EZPMP 픽 기준: 최소 스코어 이상 + 스코어 내림차순 top N */
export const EZPMP_PICK_MIN_SCORE = 15;

/** Weekly Event List 최소 스코어 - 총회·이사회 등 무관 행사 제거 */
export const WEEKLY_LIST_MIN_SCORE = 13;

/** Weekly Event List 제외 키워드 (행사명에 포함되면 제외) */
export const WEEKLY_EXCLUDE_KEYWORDS = [
  "정기총회", "임시총회", "이사회", "간담회", "위원회",
  "강의", "교육", "워크숍", "workshop", "세미나", "seminar",
  "출산", "육아", "임신", "영유아", "맘", "베이비", "baby", "키즈", "kids",
  "키즈카페", "놀이터", "놀이공간", "놀이시설", "놀이구조물", "실내놀이",
];
