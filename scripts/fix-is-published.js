/**
 * DB에 이미 저장된 convention_events의 is_published를
 * 최신 isRelevant() 기준으로 재평가해서 업데이트
 *
 * 실행: node scripts/fix-is-published.js
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://pdnumzklfckhdepdpmwi.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkbnVtemtsZmNraGRlcGRwbXdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc0NzY0NCwiZXhwIjoyMDkyMzIzNjQ0fQ.0zAj5vt-zNbk7Ec0lWqUHVjPodlqgNa7OYKyU9VQxKQ";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── isRelevant 기준 (import-convention-events.js와 동일하게 유지) ──
const IRRELEVANT_CATEGORIES = ["문화행사"];

const IRRELEVANT_NAME_KEYWORDS = [
  // 공연·예술
  "콘서트", "공연", "연극", "뮤지컬", "갈라", "오케스트라", "밴드", "팬미팅", "팬사인회", "버스킹",
  // 어린이·교육
  "어린이", "키즈", "아동", "유아", "영아", "어린이집",
  // 종교
  "종교", "예배", "미사", "기도", "수련회", "성경",
  // 결혼
  "웨딩", "결혼", "브라이덜",
  // 시장·축제
  "프리마켓", "플리마켓", "야시장",
  // 댄스·체육
  "댄스", "발레", "체조", "체육대회", "운동회", "마라톤",
  // 건설·토목·공사
  "정비공사", "하수관", "상수도", "배수관", "토목공사", "설계 ve", "ve 검토", "ve검토",
  // 의료·응급 내부교육
  "구급대원", "외상처치", "응급처치교육", "소방훈련",
  // 내부 조직 행사
  "발대식", "출범식", "취임식", "이임식", "임명식", "현판식", "개소식", "기공식", "준공식", "창단식",
  // 학교 행사
  "졸업식", "입학식", "수료식",
  // 대관 (장소 대관) 행사
  "대관 행사", "대관행사",
  // 내부 회사 행사 패턴
  "상반기 워크샵", "하반기 워크샵", "상반기워크샵", "하반기워크샵",
  // 기타 내부 교육 (직종 특화)
  "소방공무원", "경찰관교육", "세무조사", "감사교육",
  // 학교·입시 행사
  "입학설명회", "학교설명회", "진학설명회", "입시설명회", "대학교설명회", "학원설명회",
  "지원전략 설명회", "지원전략설명회", "입시 전략", "수시설명회", "정시설명회",
  "고등학교", "중학교", "초등학교", "대학교 입학", "유학설명회",
  // 의료 행정·보건 사업
  "만성질환", "일차의료", "보건사업", "건강검진", "예방접종", "방문간호",
  // 선거·행정
  "개표소", "지방선거", "선거관리", "투표소", "국회의원선거",
  // 소규모 내부 세미나 패턴
  "원데이 세미나", "원데이세미나", "one-day 세미나",
  // 내부 과제·업무 회의
  "업무 추진", "업무추진", "과제 워크샵", "과제워크샵",
  // 공공 공모·행정 설명회
  "공모사업", "농산어촌", "학교복합시설", "공익사업 설명회",
  // 의학 특정 학회 연수
  "연수강좌", "보수교육",
  // 내부 업무 협의·간담회
  "태양광 협의", "업무 협의", "업무협의", "실무 협의",
  "간담회", "협약식", "협약체결",
  // 내부 평가·심사
  "제안서 평가", "심사위원회", "평가위원회",
];

function isRelevant(event) {
  if (IRRELEVANT_CATEGORIES.includes(event.category)) return false;

  const name = (event.event_name || "").trim();

  // 행사명이 너무 짧거나 비어있으면 제외
  if (name.length <= 4) return false;

  // 회사명만 있는 대관 패턴 제외
  const companyOnlyPattern = /^(\(주\)|㈜|주식회사|유한회사|합자회사)\s*\S+\s*$/;
  if (companyOnlyPattern.test(name)) return false;

  const nameLower = name.toLowerCase();
  if (IRRELEVANT_NAME_KEYWORDS.some((kw) => nameLower.includes(kw.toLowerCase()))) return false;

  return true;
}

async function main() {
  console.log("🔍 DB에서 모든 행사 가져오는 중...");

  // 전체 조회 (페이지네이션)
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("convention_events")
      .select("id, event_name, category, is_published")
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`   총 ${all.length}건 로드\n`);

  // 재평가
  const toPublish   = all.filter(e => !e.is_published && isRelevant(e));
  const toUnpublish = all.filter(e =>  e.is_published && !isRelevant(e));

  console.log(`✅ 공개로 변경할 건수: ${toPublish.length}`);
  console.log(`🚫 비공개로 변경할 건수: ${toUnpublish.length}`);

  if (toUnpublish.length > 0) {
    console.log("\n📋 비공개로 바꿀 행사 목록:");
    toUnpublish.forEach(e => console.log(`   [${e.venue ?? ""}] ${e.event_name}`));
  }

  // 업데이트
  let updated = 0;

  for (const e of toPublish) {
    await supabase.from("convention_events").update({ is_published: true }).eq("id", e.id);
    updated++;
  }
  for (const e of toUnpublish) {
    await supabase.from("convention_events").update({ is_published: false }).eq("id", e.id);
    updated++;
  }

  console.log(`\n🎉 완료! ${updated}건 업데이트됨`);
}

main();
