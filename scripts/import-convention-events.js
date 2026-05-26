/**
 * 전국 컨벤션센터 행사 일정 CSV → Supabase 임포트 스크립트
 * 실행: node scripts/import-convention-events.js
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ── Supabase 연결 ────────────────────────────────────────────────
const SUPABASE_URL = "https://pdnumzklfckhdepdpmwi.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkbnVtemtsZmNraGRlcGRwbXdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc0NzY0NCwiZXhwIjoyMDkyMzIzNjQ0fQ.0zAj5vt-zNbk7Ec0lWqUHVjPodlqgNa7OYKyU9VQxKQ";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── CSV 기본 파서 (따옴표 처리 포함) ─────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines.map((line) => {
    const fields = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  });
}

// ── 날짜 파싱 유틸 ───────────────────────────────────────────────
// "2026.05.20" / "2026-05-20" / "2026-05-20 00:00" → "2026-05-20"
function normalizeDate(str) {
  if (!str) return null;
  const s = str.trim().replace(/\./g, "-").split(" ")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// "2026.01.16~2026.01.25" / "2026-05-28 ~ 2026-05-29" → [start, end]
function parsePeriod(str) {
  if (!str) return [null, null];
  const parts = str.split(/~|～/).map((s) => s.trim());
  return [normalizeDate(parts[0]), normalizeDate(parts[1] || parts[0])];
}

// ── 카테고리 정규화 ──────────────────────────────────────────────
function normalizeCategory(raw) {
  if (!raw) return "기타";
  const r = raw.toLowerCase();
  if (r.includes("exhibition") || r.includes("전시")) return "전시";
  if (r.includes("convention") || r.includes("회의") || r.includes("컨벤션")) return "회의";
  if (r.includes("event") || r.includes("이벤트") || r.includes("공연")) return "이벤트";
  if (r.includes("문화")) return "문화행사";
  return "기타";
}

// HTML 엔티티 디코딩
function decodeHtml(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "");
}

// ── 파일별 파서 ──────────────────────────────────────────────────
const DOCS = path.join(__dirname, "../docs/컨벤션센터 행사");

function parseCoex(filename, venue, region) {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, filename), "utf8"));
  const results = [];
  // 헤더: 행사분류,행사구분,행사분야,행사명,행사명(서브타이틀),행사 시작일자,행사 종료일자,행사 장소,입장료,주최,주관,...
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[3] || r[3].trim() === "") continue;
    results.push({
      venue,
      venue_region: region,
      event_name:    decodeHtml(r[3]),
      event_name_en: decodeHtml(r[4]) || null,
      start_date:    normalizeDate(r[5]),
      end_date:      normalizeDate(r[6]),
      location:      r[7] || null,
      category:      normalizeCategory(r[0]),
      industry:      r[2] || null,
      organizer:     decodeHtml(r[9]) || null,
      operator:      decodeHtml(r[10]) || null,
      website:       r[14] || null,
    });
  }
  return results;
}

function parseCoexMagok(filename, venue, region) {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, filename), "utf8"));
  const results = [];
  // 헤더: 행사분류,행사구분,행사분야,행사명,행사명(서브타이틀),행사 시작일자,행사 종료일자,행사 장소,주최,주관,관련 사이트
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[3] || r[3].trim() === "") continue;
    results.push({
      venue,
      venue_region: region,
      event_name:    decodeHtml(r[3]),
      event_name_en: decodeHtml(r[4]) || null,
      start_date:    normalizeDate(r[5]),
      end_date:      normalizeDate(r[6]),
      location:      r[7] || null,
      category:      normalizeCategory(r[0]),
      industry:      r[2] || null,
      organizer:     decodeHtml(r[8]) || null,
      operator:      decodeHtml(r[9]) || null,
      website:       r[10] || null,
    });
  }
  return results;
}

function parseKintex() {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, "kintex_schedule_20260522045512.csv"), "utf8"));
  const results = [];
  // 헤더 찾기: 번호,카테고리,행사명,행사기간,임대장소,주최기관,주관기관,홈페이지
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === "번호") { headerIdx = i; break; }
  }
  if (headerIdx === -1) return results;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[2] || r[2].trim() === "") continue;
    const [start, end] = parsePeriod(r[3]);
    results.push({
      venue:         "킨텍스",
      venue_region:  "경기",
      event_name:    decodeHtml(r[2]),
      event_name_en: null,
      start_date:    start,
      end_date:      end,
      location:      r[4] || null,
      category:      normalizeCategory(r[1]),
      industry:      null,
      organizer:     decodeHtml(r[5]) || null,
      operator:      decodeHtml(r[6]) || null,
      website:       r[7] || null,
    });
  }
  return results;
}

function parseSongdo() {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, "송도컨벤시아 행사일정(2026).csv"), "utf8"));
  const results = [];
  // 헤더 찾기: 구분,행사명,행사명(영문),기간,장소,웹사이트,주최,주관
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][1] === "행사명") { headerIdx = i; break; }
  }
  if (headerIdx === -1) return results;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[1] || r[1].trim() === "") continue;
    const [start, end] = parsePeriod(r[3]);
    results.push({
      venue:         "송도컨벤시아",
      venue_region:  "인천",
      event_name:    decodeHtml(r[1]),
      event_name_en: decodeHtml(r[2]) || null,
      start_date:    start,
      end_date:      end,
      location:      r[4] || null,
      category:      normalizeCategory(r[0]),
      industry:      null,
      organizer:     decodeHtml(r[6]) || null,
      operator:      decodeHtml(r[7]) || null,
      website:       r[5] || null,
    });
  }
  return results;
}

function parseChangwon() {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, "창원컨벤션센터_행사일정_260522.csv"), "utf8"));
  const results = [];
  // 헤더: 행사명,행사 기간,개최 장소,행사 홈페이지
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || r[0].trim() === "") continue;
    const [start, end] = parsePeriod(r[1]);
    results.push({
      venue:         "창원컨벤션센터",
      venue_region:  "경남",
      event_name:    decodeHtml(r[0]),
      event_name_en: null,
      start_date:    start,
      end_date:      end,
      location:      r[2] || null,
      category:      "전시",
      industry:      null,
      organizer:     null,
      operator:      null,
      website:       r[3] || null,
    });
  }
  return results;
}

function parseDaejeon() {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, "대전컨벤션센터_2026년_일정.csv"), "utf8"));
  const results = [];
  // 헤더: 번호,카테고리,행사명,행사 시작일,행사 종료일,행사시간,임대장소,주최기관,전화번호,홈페이지,입장료
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][2] === "행사명") { headerIdx = i; break; }
  }
  if (headerIdx === -1) return results;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[2] || r[2].trim() === "") continue;
    results.push({
      venue:         "대전컨벤션센터",
      venue_region:  "대전",
      event_name:    decodeHtml(r[2]),
      event_name_en: null,
      start_date:    normalizeDate(r[3]),
      end_date:      normalizeDate(r[4]),
      location:      r[6] || null,
      category:      normalizeCategory(r[1]),
      industry:      null,
      organizer:     decodeHtml(r[7]) || null,
      operator:      null,
      website:       r[9] || null,
    });
  }
  return results;
}

function parseOsco() {
  const rows = parseCSV(fs.readFileSync(path.join(DOCS, "청주 오스코_행사일정_2026-05-01_2026-12-31.csv"), "utf8"));
  const results = [];
  // 헤더: 번호,카테고리,행사명,행사기간,행사장소,주최기관,주관기관,홈페이지
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][2] === "행사명") { headerIdx = i; break; }
  }
  if (headerIdx === -1) return results;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[2] || r[2].trim() === "") continue;
    const [start, end] = parsePeriod(r[3]);
    results.push({
      venue:         "청주 오스코",
      venue_region:  "충북",
      event_name:    decodeHtml(r[2]),
      event_name_en: null,
      start_date:    start,
      end_date:      end,
      location:      r[4] || null,
      category:      normalizeCategory(r[1]),
      industry:      null,
      organizer:     decodeHtml(r[5]) || null,
      operator:      decodeHtml(r[6]) || null,
      website:       r[7] || null,
    });
  }
  return results;
}

// ── 이즈피엠피 관련성 판단 ──────────────────────────────────────
// 실제 행사 진행 내역(Ezpmp 행사 진행 내역_260522.csv) 기반
// 비관련: 순수 소비자 문화행사 / 공연 / 어린이 행사 → is_published=false

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
  // 내부 조직 행사 (발대식·취임식 등)
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
  // 내부 업무 협의·간담회 (행사명이 협의/간담회로만 끝나는 경우)
  "태양광 협의", "업무 협의", "업무협의", "실무 협의",
  "간담회", "협약식", "협약체결",
  // 내부 평가·심사
  "제안서 평가", "심사위원회", "평가위원회",
];

function isRelevant(event) {
  // 문화행사 카테고리 전체 제외
  if (IRRELEVANT_CATEGORIES.includes(event.category)) return false;

  const name = (event.event_name || "").trim();

  // 행사명이 너무 짧거나 비어있으면 제외 (단순 대관: "대관", "행사" 등)
  if (name.length <= 4) return false;

  // 회사명만 있는 대관 패턴: "(주)xxx", "㈜xxx", "주식회사xxx", "유한회사xxx" 로만 구성
  // → 뒤에 행사 관련 단어가 없으면 제외
  const companyOnlyPattern = /^(\(주\)|㈜|주식회사|유한회사|합자회사)\s*\S+\s*$/;
  if (companyOnlyPattern.test(name)) return false;

  // 비관련 키워드 포함 시 제외
  const nameLower = name.toLowerCase();
  if (IRRELEVANT_NAME_KEYWORDS.some((kw) => nameLower.includes(kw.toLowerCase()))) return false;

  return true;
}

// ── 메인 실행 ────────────────────────────────────────────────────
async function main() {
  console.log("📦 CSV 파싱 시작...\n");

  const all = [
    ...parseCoex("Coex_Schedule_20260522163903.csv", "코엑스", "서울"),
    ...parseCoexMagok("Coex_Magok_Schedule_20260522165924.csv", "코엑스 마곡", "서울"),
    ...parseKintex(),
    ...parseSongdo(),
    ...parseChangwon(),
    ...parseDaejeon(),
    ...parseOsco(),
  ];

  // 날짜 없는 항목 필터 + is_published 설정
  const valid = all
    .filter((e) => e.event_name && e.start_date)
    .map((e) => ({ ...e, is_published: isRelevant(e) }));

  const published = valid.filter((e) => e.is_published);
  const hidden    = valid.filter((e) => !e.is_published);
  console.log(`✅ 파싱 완료: 총 ${all.length}건 → 유효 ${valid.length}건 (공개 ${published.length}건 / 비공개 ${hidden.length}건)\n`);

  // 컨벤션센터별 집계 출력
  const byVenue = {};
  for (const e of published) {
    byVenue[e.venue] = (byVenue[e.venue] || 0) + 1;
  }
  for (const [v, c] of Object.entries(byVenue)) {
    console.log(`  ${v}: ${c}건`);
  }
  if (hidden.length > 0) {
    console.log(`\n  ⛔ 비공개 처리: ${hidden.length}건 (문화행사·공연·어린이 행사 등)`);
  }
  console.log();

  // 기존 데이터 삭제 후 재삽입 (중복 방지)
  console.log("🗑️  기존 convention_events 데이터 삭제...");
  const { error: delErr } = await supabase
    .from("convention_events")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) {
    console.error("삭제 오류:", delErr.message);
    process.exit(1);
  }

  // 100건씩 배치 삽입
  console.log("📤 Supabase에 삽입 중...");
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    const { error } = await supabase.from("convention_events").insert(chunk);
    if (error) {
      console.error(`배치 ${i}~${i + BATCH} 삽입 오류:`, error.message);
      process.exit(1);
    }
    inserted += chunk.length;
    process.stdout.write(`\r  진행: ${inserted}/${valid.length}건`);
  }

  console.log(`\n\n🎉 완료! ${inserted}건 삽입됨`);
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
