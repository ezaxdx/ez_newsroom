/**
 * 웹 스크래핑으로 수집한 추가 컨벤션센터 행사 임포트
 * 대상: SETEC, 벡스코, 경주화백, 김대중, 군산새만금, 제주ICC, 수원, aT센터
 * 실행: node scripts/import-scraped-events.js
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://pdnumzklfckhdepdpmwi.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkbnVtemtsZmNraGRlcGRwbXdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc0NzY0NCwiZXhwIjoyMDkyMzIzNjQ0fQ.0zAj5vt-zNbk7Ec0lWqUHVjPodlqgNa7OYKyU9VQxKQ";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── 수집된 행사 데이터 ──────────────────────────────────────────
const SCRAPED_EVENTS = [

  // ── SETEC (서울 강남) ──────────────────────────
  { venue: "SETEC", venue_region: "서울", event_name: "2026 더골프쇼&더캠핑쇼 in서울", start_date: "2026-05-28", end_date: "2026-05-31", location: "제3전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "라스트 페어 2026", start_date: "2026-05-30", end_date: "2026-05-31", location: "제2전시실", category: "전시", organizer: null, website: null, is_published: false },
  { venue: "SETEC", venue_region: "서울", event_name: "하비페어 2026", start_date: "2026-06-06", end_date: "2026-06-07", location: "제1전시실", category: "전시", organizer: null, website: null, is_published: false },
  { venue: "SETEC", venue_region: "서울", event_name: "제8회 대한민국민화아트페어", start_date: "2026-06-11", end_date: "2026-06-14", location: "제1전시실", category: "전시", organizer: null, website: null, is_published: false },
  { venue: "SETEC", venue_region: "서울", event_name: "제27회 제일창업박람회 in서울", start_date: "2026-06-18", end_date: "2026-06-20", location: "제1~2전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "2026 미트엑스포", start_date: "2026-06-18", end_date: "2026-06-20", location: "제3전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "2026 재테크트렌드페어", start_date: "2026-06-26", end_date: "2026-06-27", location: "제1~2전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "2026 서울가구박람회", start_date: "2026-07-02", end_date: "2026-07-05", location: "제1~3전시실", category: "전시", organizer: null, website: null, is_published: false },
  { venue: "SETEC", venue_region: "서울", event_name: "제2회 대한민국 대표 중소기업 박람회", start_date: "2026-07-22", end_date: "2026-07-24", location: "제1~2전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "코사운드 스테이지테크 2026", start_date: "2026-09-02", end_date: "2026-09-04", location: "제1~3전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "2026 코리아 이커머스 페어", start_date: "2026-09-17", end_date: "2026-09-19", location: "제1~3전시실", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "SETEC", venue_region: "서울", event_name: "강남 디지털 DNA 페스티벌", start_date: "2026-09-30", end_date: "2026-09-30", location: "제1~2전시실", category: "전시", organizer: null, website: null, is_published: true },

  // ── 벡스코 (부산) ──────────────────────────────
  { venue: "벡스코", venue_region: "부산", event_name: "KGA 국제보전프로그램 전략 수립 국제학술대회", start_date: "2026-05-27", end_date: "2026-05-28", location: "제1회의실 311-317호", category: "회의", organizer: null, website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "제33회 부산국제식품대전", start_date: "2026-05-27", end_date: "2026-05-30", location: "제1전시장 1홀", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "제16회 부산커피쇼", start_date: "2026-05-27", end_date: "2026-05-30", location: "제1전시장 2홀", category: "전시", organizer: null, website: null, is_published: false },
  { venue: "벡스코", venue_region: "부산", event_name: "2026 생화학분자생물학회 국제학술대회", start_date: "2026-05-27", end_date: "2026-05-29", location: "컨벤션홀 전층", category: "회의", organizer: "한국생화학분자생물학회", website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "2026 대한노인병학회 춘계 학술대회", start_date: "2026-05-30", end_date: "2026-05-31", location: "컨벤션홀 201-202호", category: "회의", organizer: "대한노인병학회", website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "한국경제TV 증권 세미나", start_date: "2026-05-30", end_date: "2026-05-30", location: "컨벤션홀 106-107호", category: "회의", organizer: "한국경제TV", website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "부산 건축박람회 / 공구전", start_date: "2026-06-04", end_date: "2026-06-07", location: "제1전시장 2A홀", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "부산콘텐츠마켓 2026", start_date: "2026-06-10", end_date: "2026-06-12", location: "제1전시장 3홀", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "2026 부산디자인페스티벌", start_date: "2026-06-11", end_date: "2026-06-14", location: "제2전시장 4(A-C)홀", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "2026 부산약사회 연수교육", start_date: "2026-06-21", end_date: "2026-06-21", location: "컨벤션홀 전층", category: "회의", organizer: "부산약사회", website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "2026년도 한국전기전자재료학회 하계학술대회", start_date: "2026-06-24", end_date: "2026-06-26", location: "컨벤션홀 전층", category: "회의", organizer: "한국전기전자재료학회", website: null, is_published: true },
  { venue: "벡스코", venue_region: "부산", event_name: "2026 코리아캠핑카쇼", start_date: "2026-06-25", end_date: "2026-06-28", location: "제2전시장 4홀", category: "전시", organizer: null, website: null, is_published: false },

  // ── 경주화백컨벤션센터 HICO ────────────────────
  { venue: "경주화백컨벤션센터", venue_region: "경북 경주", event_name: "2026 대한외과학회 춘계학술대회 및 외과내시경 연수강좌", start_date: "2026-05-29", end_date: "2026-05-31", location: "경주화백컨벤션센터 전관", category: "회의", organizer: "대한외과학회", website: null, is_published: true },

  // ── 김대중컨벤션센터 (광주) ────────────────────
  { venue: "김대중컨벤션센터", venue_region: "광주", event_name: "2026 광주식품대전", start_date: "2026-05-21", end_date: "2026-06-24", location: "전시장, 다목적홀", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "김대중컨벤션센터", venue_region: "광주", event_name: "제2회 2026 코리아 국제 푸드 & 우리밀 제과 챔피언쉽", start_date: "2026-05-30", end_date: "2026-05-30", location: "열린홀", category: "전시", organizer: null, website: null, is_published: true },
  { venue: "김대중컨벤션센터", venue_region: "광주", event_name: "2026 하나 JOB 매칭 페스타 in 광주", start_date: "2026-06-23", end_date: "2026-06-23", location: "다목적 제1홀", category: "이벤트", organizer: null, website: null, is_published: true },

  // ── 군산새만금컨벤션센터 ───────────────────────
  { venue: "군산새만금컨벤션센터", venue_region: "전북 군산", event_name: "새만금 태양광 협의", start_date: "2026-05-27", end_date: "2026-05-27", location: "203호", category: "회의", organizer: "㈜새만금희망태양광", website: null, is_published: false },
  { venue: "군산새만금컨벤션센터", venue_region: "전북 군산", event_name: "유해화학물질교육", start_date: "2026-06-04", end_date: "2026-06-05", location: "101호", category: "회의", organizer: "한국화학물질관리협회", website: null, is_published: true },
  { venue: "군산새만금컨벤션센터", venue_region: "전북 군산", event_name: "군산시청 교통행정과 보수교육", start_date: "2026-06-23", end_date: "2026-06-27", location: "컨벤션홀1,2", category: "회의", organizer: "군산시청", website: null, is_published: true },
  { venue: "군산새만금컨벤션센터", venue_region: "전북 군산", event_name: "전북가구쇼", start_date: "2026-09-11", end_date: "2026-09-13", location: "전시장, 컨벤션홀", category: "전시", organizer: "네모전람", website: null, is_published: false },

  // ── 제주국제컨벤션센터 ─────────────────────────
  { venue: "제주국제컨벤션센터", venue_region: "제주", event_name: "2026 한국해양과학기술협의회 공동학술대회", start_date: "2026-05-28", end_date: "2026-05-29", location: "제주국제컨벤션센터", category: "회의", organizer: "한국해양과학기술협의회", website: null, is_published: true },

  // ── 수원컨벤션센터 ─────────────────────────────
  { venue: "수원컨벤션센터", venue_region: "경기 수원", event_name: "광교 양자 바이오 서밋 2026", start_date: "2026-05-27", end_date: "2026-05-29", location: "수원컨벤션센터", category: "회의", organizer: "수원컨벤션센터", website: null, is_published: true },
  { venue: "수원컨벤션센터", venue_region: "경기 수원", event_name: "2026 KSQA 상반기 워크샵", start_date: "2026-05-28", end_date: "2026-05-28", location: "4층", category: "회의", organizer: "한국신뢰성보증연구협동조합", website: null, is_published: true },
  { venue: "수원컨벤션센터", venue_region: "경기 수원", event_name: "2026 수원펫&캣쇼", start_date: "2026-06-05", end_date: "2026-06-07", location: "전시홀(1F)", category: "전시", organizer: "㈜미래전람", website: null, is_published: false },
  { venue: "수원컨벤션센터", venue_region: "경기 수원", event_name: "팔도밥상페어 2026", start_date: "2026-07-02", end_date: "2026-07-05", location: "전시홀(1F)", category: "전시", organizer: null, website: null, is_published: false },

  // ── aT센터 (서울 양재) ─────────────────────────
  { venue: "aT센터", venue_region: "서울", event_name: "제21회 대한민국 보조공학기기 박람회", start_date: "2026-05-28", end_date: "2026-05-29", location: "제1전시장", category: "전시", organizer: null, website: null, is_published: true },
];

async function main() {
  const total = SCRAPED_EVENTS.length;
  const published = SCRAPED_EVENTS.filter((e) => e.is_published).length;
  const hidden    = total - published;

  console.log(`📦 스크래핑 데이터 임포트 시작`);
  console.log(`   총 ${total}건 (공개 ${published}건 / 비공개 ${hidden}건)\n`);

  // 센터별 집계
  const byVenue = {};
  for (const e of SCRAPED_EVENTS.filter((e) => e.is_published)) {
    byVenue[e.venue] = (byVenue[e.venue] || 0) + 1;
  }
  for (const [v, c] of Object.entries(byVenue)) {
    console.log(`  ${v}: ${c}건`);
  }
  console.log();

  // 배치 삽입 (중복 무시)
  console.log("📤 Supabase에 삽입 중...");
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < SCRAPED_EVENTS.length; i += BATCH) {
    const chunk = SCRAPED_EVENTS.slice(i, i + BATCH);
    const { error } = await supabase.from("convention_events").insert(chunk);
    if (error) {
      console.error(`배치 삽입 오류:`, error.message);
      process.exit(1);
    }
    inserted += chunk.length;
  }

  console.log(`🎉 완료! ${inserted}건 삽입됨`);
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
