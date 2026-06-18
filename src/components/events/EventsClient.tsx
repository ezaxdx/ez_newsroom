"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, MapPin, Calendar } from "lucide-react";
import { logEvent } from "@/lib/analytics";

export type ConventionEvent = {
  id: string;
  venue: string;
  venue_region: string | null;
  event_name: string;
  event_name_en: string | null;
  start_date: string;
  end_date: string | null;
  location: string | null;
  category: string | null;
  industry: string | null;
  organizer: string | null;
  website: string | null;
};

type Props = { events: ConventionEvent[] };

// ── 이즈피엠피 행사 진행 내역 기반 관심 키워드 ───────────────────
// 실제 수행 이력: 월드스마트시티엑스포(매년), NextRise(매년), 콘텐츠IP마켓(매년),
//               BCWW(매년), P4G/APEC/환경장관회의, 정부박람회, AI정상회의,
//               BIXPO, 기후산업박람회, 관광박람회, 스마트국토 등
const EZPMP_HIGH_MATCH: string[] = [
  // 기술/AI/스마트 (가장 많음)
  "스마트", "AI", "인공지능", "디지털", "ICT", "정보통신", "tech", "데이터",
  "사이버", "클라우드", "소프트웨어", "플랫폼", "DX",
  // 에너지/환경/기후
  "환경", "기후", "에너지", "탄소", "녹색", "순환경제", "그린", "태양광",
  "신재생", "수소", "전력",
  // 스타트업/비즈니스 (NextRise 매년)
  "스타트업", "startup", "벤처", "비즈니스", "투자", "IR",
  // 관광/MICE
  "관광", "MICE", "마이스", "여행", "travel", "tourism", "컨벤션",
  // 문화/콘텐츠 (콘텐츠IP, BCWW, 방송 매년)
  "콘텐츠", "content", "방송", "미디어", "K-콘텐츠", "웹툰", "영상",
  // 의료/헬스케어 (MEeT 준비 중)
  "의료", "헬스케어", "healthcare", "medical", "바이오", "제약", "헬스",
  // 국제회의/포럼
  "국제", "summit", "forum", "포럼", "컨퍼런스", "conference",
  // 정부/공공
  "정부", "공공", "행정", "혁신",
];

const EZPMP_MEDIUM_MATCH: string[] = [
  "전시", "박람회", "엑스포", "expo", "산업", "무역", "무역박람회",
  "우주", "항공", "모빌리티", "자동차", "부동산", "도시", "건설",
  "농업", "식품", "농축산", "수산", "해양",
  "교육", "학술", "연구", "과학",
  "안보", "방산", "국방",
  "금융", "핀테크", "경제",
];

const PREFERRED_VENUES = ["코엑스", "킨텍스"];

// ── EZPMP 실제 수행 이력 기반 파트너 기관 ─────────────────────────
// (발주처·주최기관·주관기관 전체 추출, 4자 이상만 매칭에 사용)
const EZPMP_PARTNERS: string[] = [
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
  // 광역지자체·지역 (광역시·도 이름은 다른 기관명 안에서 false-positive 발생하므로 제외)
  "광주비엔날레",
  "서울경제진흥원", "인천관광공사",
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

function isEzpmpPartner(organizer: string | null): boolean {
  if (!organizer) return false;
  // 쉼표·슬래시로 구분된 복수 기관을 각각 개별 매칭
  const orgs = organizer
    .replace(/（[^）]*）/g, "")
    .split(/[,\/]/)
    .map((o) => o.replace(/\([^)]*\)/g, "").trim().toLowerCase())
    .filter(Boolean);
  return orgs.some((orgBase) =>
    EZPMP_PARTNERS.some((p) => {
      if (p.length < 4) return false;
      const pl = p.toLowerCase();
      return orgBase === pl || orgBase.includes(pl) || pl.includes(orgBase);
    })
  );
}

function scoreEvent(event: ConventionEvent, today: Date): number {
  const searchText = [
    event.event_name,
    event.event_name_en ?? "",
    event.industry ?? "",
    event.category ?? "",
  ].join(" ").toLowerCase();

  let score = 0;

  // 키워드 매칭
  for (const kw of EZPMP_HIGH_MATCH) {
    if (searchText.includes(kw.toLowerCase())) score += 15;
  }
  for (const kw of EZPMP_MEDIUM_MATCH) {
    if (searchText.includes(kw.toLowerCase())) score += 5;
  }

  // 카테고리 보너스
  if (event.category === "전시") score += 10;
  if (event.category === "회의") score += 8;

  // 주요 컨벤션센터 보너스
  if (PREFERRED_VENUES.some((v) => event.venue?.includes(v))) score += 8;

  // EZPMP 파트너 기관 보너스
  if (isEzpmpPartner(event.organizer)) score += 30;

  // 시기 점수: 향후 7~90일이 가장 actionable
  const startMs = new Date(event.start_date).getTime();
  const daysUntil = (startMs - today.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntil >= 7 && daysUntil <= 30)  score += 20; // 임박 = 가장 높은 우선순위
  else if (daysUntil > 30 && daysUntil <= 90) score += 10;
  else if (daysUntil > 0 && daysUntil < 7)    score += 5;

  return score;
}

const CATEGORY_COLOR: Record<string, string> = {
  전시:    "#2563eb",
  회의:    "#059669",
  이벤트:  "#d97706",
  문화행사: "#7c3aed",
  기타:    "#6b7280",
};

// 도별 묶음 (가나다순)
const VENUE_GROUPS: { region: string; venues: string[] }[] = [
  { region: "", venues: ["전체"] },
  { region: "서울", venues: ["SETEC", "aT센터", "코엑스", "코엑스 마곡"] },
  { region: "경기·인천", venues: ["송도컨벤시아", "수원컨벤션센터", "킨텍스"] },
  { region: "부산·경남", venues: ["벡스코", "창원컨벤션센터"] },
  { region: "대구·경북", venues: ["경주화백컨벤션센터"] },
  { region: "광주·전라", venues: ["군산새만금컨벤션센터", "김대중컨벤션센터"] },
  { region: "대전·충청", venues: ["대전컨벤션센터", "청주 오스코"] },
  { region: "제주", venues: ["제주국제컨벤션센터"] },
];
// 평탄화 (필터 로직에서 사용)
const VENUE_LIST = VENUE_GROUPS.flatMap((g) => g.venues);

const CATEGORY_LIST = ["전체", "전시", "회의", "이벤트", "문화행사", "기타"];

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

export default function EventsClient({ events }: Props) {
  const today = new Date();
  const todayDateStr = today.toISOString().split("T")[0];

  // ── 이즈피엠피 맞춤 추천 (상위 4건) ─────────────────────────────
  const recommendations = useMemo(() => {
    return [...events]
      .filter((e) => e.start_date >= todayDateStr) // 지난 행사 제외 (날짜 문자열 비교 → KST 기준 오늘 포함)
      .map((e) => ({ event: e, score: scoreEvent(e, today) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .sort((a, b) => a.event.start_date.localeCompare(b.event.start_date))
      .map(({ event }) => event);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [venueFilter,    setVenueFilter]    = useState("전체");
  const [categoryFilter, setCategoryFilter] = useState("전체");

  /* ── 달력 날짜 계산 ─────────────────────────────── */
  const firstDay   = new Date(year, month, 1).getDay();  // 0=일
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = useMemo(() => {
    const cells: (number | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month, firstDay, daysInMonth]);

  /* ── 이 달의 행사 날짜 집합 ─────────────────────── */
  const eventDaysInMonth = useMemo(() => {
    const set = new Set<number>();
    for (const e of events) {
      const sd = new Date(e.start_date);
      const ed = e.end_date ? new Date(e.end_date) : sd;
      const cur = new Date(sd);
      while (cur <= ed) {
        if (cur.getFullYear() === year && cur.getMonth() === month)
          set.add(cur.getDate());
        cur.setDate(cur.getDate() + 1);
      }
    }
    return set;
  }, [events, year, month]);

  /* ── 필터 + 날짜 선택 + 현재 보는 달 범위 + 지난 행사 제외 ── */
  const filteredEvents = useMemo(() => {
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0); // 해당 달 마지막 날
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return events.filter((e) => {
      if (venueFilter    !== "전체" && e.venue    !== venueFilter)    return false;
      if (categoryFilter !== "전체" && e.category !== categoryFilter) return false;
      const sd = new Date(e.start_date);
      const ed = e.end_date ? new Date(e.end_date) : sd;
      // 이미 종료된 행사 제외 (종료일이 오늘 이전)
      if (ed < todayMidnight) return false;
      // 현재 달과 겹치는 행사만 표시
      if (ed < monthStart || sd > monthEnd) return false;
      // 날짜 선택 시 해당 날만
      if (selectedDay !== null) {
        const target = new Date(year, month, selectedDay);
        if (target < sd || target > ed) return false;
      }
      return true;
    }).sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [events, venueFilter, categoryFilter, selectedDay, year, month, today]);

  /* ── 달 이동 ────────────────────────────────────── */
  function prevMonth() {
    setSelectedDay(null);
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    setSelectedDay(null);
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  /* ── 날짜 포맷 ──────────────────────────────────── */
  function fmtDate(s: string) {
    const d = new Date(s);
    return `${d.getMonth()+1}/${d.getDate()}`;
  }
  function fmtRange(start: string, end: string | null) {
    if (!end || start === end) return fmtDate(start);
    return `${fmtDate(start)} ~ ${fmtDate(end)}`;
  }

  const catColor = (cat: string | null) =>
    CATEGORY_COLOR[cat ?? "기타"] ?? CATEGORY_COLOR["기타"];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px 80px" }}>

      {/* ── 페이지 타이틀 ── */}
      <div style={{ padding: "40px 0 32px" }}>
        <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 600,
          letterSpacing: "0.08em", textTransform: "uppercase",
          color: "var(--on-surface-variant)" }}>
          Convention Calendar
        </p>
        <h2 style={{ margin: "4px 0 0", fontSize: "clamp(1.6rem,3vw,2.2rem)",
          fontWeight: 700, letterSpacing: "-0.02em", color: "var(--on-surface)" }}>
          전국 컨벤션 행사 일정
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: "0.9rem",
          color: "var(--on-surface-variant)" }}>
          전국 주요 컨벤션센터의 행사 일정을 한눈에 확인하세요.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 32 }}>

        {/* ── 왼쪽: 캘린더 + EZPMP Picks ── */}
        <div>
          <div style={{ position: "sticky", top: 100 }}>
          <div style={{ background: "var(--surface-container-lowest)",
            border: "1px solid var(--surface-container-high)",
            borderRadius: 16, padding: "20px 16px" }}>

            {/* 월 헤더 */}
            <div style={{ display: "flex", alignItems: "center",
              justifyContent: "space-between", marginBottom: 16 }}>
              <button onClick={prevMonth} style={{ background: "none", border: "none",
                cursor: "pointer", padding: 4, borderRadius: 6,
                color: "var(--on-surface-variant)" }}>
                <ChevronLeft size={18} />
              </button>
              <span style={{ fontWeight: 700, fontSize: "1rem",
                color: "var(--on-surface)" }}>
                {year}년 {MONTHS[month]}
              </span>
              <button onClick={nextMonth} style={{ background: "none", border: "none",
                cursor: "pointer", padding: 4, borderRadius: 6,
                color: "var(--on-surface-variant)" }}>
                <ChevronRight size={18} />
              </button>
            </div>

            {/* 요일 헤더 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)",
              marginBottom: 4 }}>
              {DAYS.map((d, i) => (
                <div key={d} style={{ textAlign: "center", fontSize: "0.68rem",
                  fontWeight: 600, padding: "4px 0",
                  color: i === 0 ? "#ef4444" : i === 6 ? "#3b82f6"
                    : "var(--on-surface-variant)" }}>
                  {d}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
              {calendarCells.map((day, idx) => {
                if (!day) return <div key={idx} />;
                const hasEvent  = eventDaysInMonth.has(day);
                const isSelected = selectedDay === day;
                const isToday   = year === today.getFullYear()
                  && month === today.getMonth() && day === today.getDate();
                const col = idx % 7;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    style={{
                      position: "relative",
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 0",
                      cursor: hasEvent ? "pointer" : "default",
                      fontWeight: isToday ? 700 : 400,
                      fontSize: "0.82rem",
                      color: isSelected ? "#fff"
                        : col === 0 ? "#ef4444"
                        : col === 6 ? "#3b82f6"
                        : "var(--on-surface)",
                      background: isSelected ? "#1a1c1d" : "transparent",
                      transition: "background 0.15s",
                    }}
                  >
                    {day}
                    {hasEvent && (
                      <span style={{
                        position: "absolute", bottom: 3, left: "50%",
                        transform: "translateX(-50%)",
                        width: 4, height: 4, borderRadius: "50%",
                        background: isSelected ? "#fff" : "#2563eb",
                        display: "block",
                      }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 선택된 날짜 표시 */}
            {selectedDay && (
              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8,
                background: "var(--surface-container)",
                fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
                {month + 1}월 {selectedDay}일 행사 {filteredEvents.length}건
                <button onClick={() => setSelectedDay(null)}
                  style={{ marginLeft: 8, background: "none", border: "none",
                    cursor: "pointer", fontSize: "0.75rem",
                    color: "var(--on-surface-variant)" }}>
                  ✕ 해제
                </button>
              </div>
            )}
          </div>

          {/* 범례 */}
          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(CATEGORY_COLOR).map(([cat, color]) => (
              <span key={cat} style={{ display: "flex", alignItems: "center",
                gap: 4, fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%",
                  background: color, display: "inline-block" }} />
                {cat}
              </span>
            ))}
          </div>

          {/* ── EZPMP Picks ── */}
          {recommendations.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ marginBottom: 10 }}>
                <p style={{ margin: "0 0 1px", fontSize: "0.65rem", fontWeight: 600,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  color: "var(--on-surface-variant)" }}>
                  EZPMP Picks
                </p>
                <p style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700,
                  color: "var(--on-surface)" }}>
                  🎯 이 행사 어때요?
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recommendations.map((e) => (
                  <RecommendCard key={e.id} event={e} fmtRange={fmtRange} catColor={catColor} />
                ))}
              </div>
            </div>
          )}
          </div>{/* /sticky */}
        </div>{/* /left column */}

        {/* ── 오른쪽: 필터 + 리스트 ── */}
        <div>
          {/* 필터 바 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
            <VenueDropdown value={venueFilter} onChange={setVenueFilter} />
            <div style={{ width: 1, background: "var(--surface-container-high)", margin: "0 4px", alignSelf: "stretch" }} />
            <FilterGroup label="분류" options={CATEGORY_LIST}
              value={categoryFilter} onChange={setCategoryFilter} />
          </div>

          {/* 건수 */}
          <p style={{ margin: "0 0 16px", fontSize: "0.82rem",
            color: "var(--on-surface-variant)" }}>
            {filteredEvents.length}건
          </p>

          {/* 행사 리스트 */}
          {filteredEvents.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center",
              color: "var(--on-surface-variant)", fontSize: "0.9rem" }}>
              해당 조건의 행사가 없습니다.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredEvents.map((e) => (
                <EventCard key={e.id} event={e}
                  allEvents={events}
                  fmtRange={fmtRange} catColor={catColor} />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

/* ── 센터 드롭다운 ── */
function VenueDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = value === "전체" ? "전체 센터" : value;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 12px", borderRadius: 20, border: "1px solid",
          fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
          borderColor: value !== "전체" ? "var(--on-surface)" : "var(--surface-container-high)",
          background: value !== "전체" ? "var(--on-surface)" : "transparent",
          color: value !== "전체" ? "var(--surface)" : "var(--on-surface-variant)",
          transition: "all 0.15s",
        }}
      >
        {label}
        <span style={{ fontSize: "0.6rem", opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          {/* 배경 클릭 시 닫기 */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0,
            zIndex: 20, minWidth: 200,
            background: "var(--surface-container-lowest)",
            border: "1px solid var(--surface-container-high)",
            borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            padding: "6px 0", overflow: "hidden",
          }}>
            {VENUE_GROUPS.map((g) => (
              <div key={g.region || "__all__"}>
                {g.region && (
                  <div style={{
                    padding: "8px 14px 4px",
                    fontSize: "0.62rem", fontWeight: 700,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    color: "var(--on-surface-variant)", opacity: 0.5,
                  }}>
                    {g.region}
                  </div>
                )}
                {g.venues.map((v) => (
                  <button
                    key={v}
                    onClick={() => { onChange(v); setOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "7px 14px", border: "none", cursor: "pointer",
                      fontSize: "0.78rem", fontWeight: value === v ? 700 : 400,
                      background: value === v ? "var(--surface-container)" : "transparent",
                      color: value === v ? "var(--on-surface)" : "var(--on-surface-variant)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(el) => { el.currentTarget.style.background = "var(--surface-container)"; }}
                    onMouseLeave={(el) => { el.currentTarget.style.background = value === v ? "var(--surface-container)" : "transparent"; }}
                  >
                    {value === v && <span style={{ marginRight: 6 }}>✓</span>}{v}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── 필터 버튼 그룹 ── */
function FilterGroup({ options, groups, value, onChange }: {
  label: string;
  options: string[];
  groups?: { region: string; venues: string[] }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const chip = (opt: string) => (
    <button key={opt} onClick={() => onChange(opt)} style={{
      padding: "4px 12px", borderRadius: 20, border: "1px solid",
      fontSize: "0.75rem", fontWeight: 500, cursor: "pointer",
      transition: "all 0.15s",
      borderColor: value === opt
        ? "var(--on-surface)" : "var(--surface-container-high)",
      background: value === opt
        ? "var(--on-surface)" : "transparent",
      color: value === opt
        ? "var(--surface)" : "var(--on-surface-variant)",
    }}>
      {opt}
    </button>
  );

  if (!groups) {
    return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{options.map(chip)}</div>;
  }

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {groups.map((g) => (
        <span key={g.region} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {g.region && (
            <span style={{
              fontSize: "0.65rem", color: "var(--on-surface-variant)",
              opacity: 0.5, fontWeight: 500, paddingLeft: 4, userSelect: "none",
            }}>
              {g.region}
            </span>
          )}
          {g.venues.map(chip)}
        </span>
      ))}
    </div>
  );
}

/* ── 추천 카드 (EZPMP Picks) ── */
function RecommendCard({ event: e, fmtRange, catColor }: {
  event: ConventionEvent;
  fmtRange: (s: string, end: string | null) => string;
  catColor: (cat: string | null) => string;
}) {
  const content = (
    <div style={{
      padding: "12px 16px",
      borderRadius: 10,
      border: "1px solid",
      borderColor: "#2563eb30",
      background: "#2563eb08",
      display: "flex",
      alignItems: "center",
      gap: 12,
      transition: "border-color 0.15s, background 0.15s",
      cursor: e.website ? "pointer" : "default",
    }}
      onMouseEnter={(el) => {
        if (!e.website) return;
        el.currentTarget.style.borderColor = "#2563eb80";
        el.currentTarget.style.background = "#2563eb12";
      }}
      onMouseLeave={(el) => {
        el.currentTarget.style.borderColor = "#2563eb30";
        el.currentTarget.style.background = "#2563eb08";
      }}
    >
      {/* 추천 배지 */}
      <span style={{
        minWidth: 28, height: 28, borderRadius: 8,
        background: "#2563eb", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
      }}>
        ★
      </span>

      {/* 내용 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
          <span style={{
            padding: "1px 7px", borderRadius: 20, fontSize: "0.65rem",
            fontWeight: 600, background: catColor(e.category) + "18",
            color: catColor(e.category),
          }}>
            {e.category ?? "기타"}
          </span>
          <span style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)" }}>
            <MapPin size={9} style={{ display: "inline", marginRight: 2 }} />
            {e.venue}
          </span>
          <span style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: 2 }}>
            <Calendar size={9} />
            {fmtRange(e.start_date, e.end_date)}
          </span>
        </div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem",
          color: "var(--on-surface)", lineHeight: 1.35,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden" }}>
          {e.event_name}
        </p>
      </div>

      {e.website && (
        <ExternalLink size={14} style={{ flexShrink: 0, color: "#2563eb", opacity: 0.7 }} />
      )}
    </div>
  );

  if (e.website) {
    return (
      <a href={e.website} target="_blank" rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
        onClick={() => logEvent({ event_type: "event_click", event_id: e.id })}>
        {content}
      </a>
    );
  }
  return content;
}

/* ── 행사 카드 ── */
function EventCard({ event: e, allEvents, fmtRange, catColor }: {
  event: ConventionEvent;
  allEvents: ConventionEvent[];
  fmtRange: (s: string, end: string | null) => string;
  catColor: (cat: string | null) => string;
}) {
  const [showMore, setShowMore] = useState(false);
  const isPartner = isEzpmpPartner(e.organizer);

  // 같은 주최기관의 다른 행사 (현재 행사 제외, 미래 것만)
  const today = new Date();
  const sameOrgEvents = useMemo(() => {
    if (!e.organizer) return [];
    const orgLower = e.organizer.toLowerCase();
    return allEvents
      .filter((ev) =>
        ev.id !== e.id &&
        ev.organizer &&
        ev.organizer.toLowerCase() === orgLower &&
        new Date(ev.start_date) >= today
      )
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.organizer, allEvents]);

  const cardContent = (
    <div style={{
      padding: "14px 18px",
      borderRadius: 12,
      border: `1px solid ${isPartner ? "#2563eb40" : "var(--surface-container-high)"}`,
      background: isPartner ? "#2563eb05" : "var(--surface-container-lowest)",
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
      transition: "border-color 0.15s, box-shadow 0.15s",
      cursor: e.website ? "pointer" : "default",
    }}
      onMouseEnter={(el) => {
        if (!e.website) return;
        el.currentTarget.style.borderColor = isPartner ? "#2563eb80" : "var(--on-surface)";
        el.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(el) => {
        el.currentTarget.style.borderColor = isPartner ? "#2563eb40" : "var(--surface-container-high)";
        el.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* 날짜 */}
      <div style={{ minWidth: 52, textAlign: "center", paddingTop: 2 }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 600,
          color: "var(--on-surface-variant)", letterSpacing: "0.04em" }}>
          {new Date(e.start_date).getMonth() + 1}월
        </div>
        <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1,
          color: "var(--on-surface)" }}>
          {new Date(e.start_date).getDate()}
        </div>
      </div>

      {/* 구분선 */}
      <div style={{ width: 1, alignSelf: "stretch", minHeight: 40,
        background: isPartner ? "#2563eb30" : "var(--surface-container-high)" }} />

      {/* 내용 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center",
          gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{
            padding: "2px 8px", borderRadius: 20, fontSize: "0.68rem",
            fontWeight: 600, letterSpacing: "0.03em",
            background: catColor(e.category) + "18",
            color: catColor(e.category),
          }}>
            {e.category ?? "기타"}
          </span>
          <span style={{ fontSize: "0.72rem", color: "var(--on-surface-variant)" }}>
            <MapPin size={10} style={{ display: "inline", marginRight: 2 }} />
            {e.venue}
          </span>
          {/* 파트너 배지 */}
          {isPartner && (
            <span style={{
              padding: "1px 7px", borderRadius: 20, fontSize: "0.62rem",
              fontWeight: 700, background: "#2563eb15", color: "#2563eb",
              border: "1px solid #2563eb30",
            }}>
              🤝 EZPMP 파트너
            </span>
          )}
        </div>

        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.92rem",
          color: "var(--on-surface)", lineHeight: 1.4,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {e.event_name}
        </p>

        <div style={{ marginTop: 4, display: "flex", alignItems: "center",
          gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--on-surface-variant)",
            display: "flex", alignItems: "center", gap: 3 }}>
            <Calendar size={10} />
            {fmtRange(e.start_date, e.end_date)}
          </span>
          {e.location && (
            <span style={{ fontSize: "0.72rem",
              color: "var(--on-surface-variant)", opacity: 0.7 }}>
              {e.location}
            </span>
          )}
          {e.website && (
            <span style={{ fontSize: "0.72rem", color: "#2563eb",
              display: "flex", alignItems: "center", gap: 2 }}>
              <ExternalLink size={10} /> 홈페이지
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const card = e.website ? (
    <a href={e.website} target="_blank" rel="noopener noreferrer"
      style={{ textDecoration: "none" }}
      onClick={() => logEvent({ event_type: "event_click", event_id: e.id })}>
      {cardContent}
    </a>
  ) : cardContent;

  return (
    <div>
      {card}

      {/* 같은 기관 다른 행사 토글 */}
      {sameOrgEvents.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 8 }}>
          <button
            onClick={() => setShowMore((v) => !v)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "0.7rem", color: "#2563eb", padding: "2px 4px",
              display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <span style={{ fontSize: "0.6rem" }}>{showMore ? "▲" : "▼"}</span>
            {e.organizer} 주최 다른 행사 {sameOrgEvents.length}건
          </button>

          {showMore && (
            <div style={{
              marginTop: 6, padding: "10px 12px",
              background: "var(--surface-container)",
              borderRadius: 10, display: "flex", flexDirection: "column", gap: 8,
              borderLeft: "3px solid #2563eb40",
            }}>
              {sameOrgEvents.map((ev) => (
                <div key={ev.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700, color: "var(--on-surface-variant)",
                    minWidth: 36, paddingTop: 1,
                  }}>
                    {new Date(ev.start_date).getMonth() + 1}/{new Date(ev.start_date).getDate()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: "0.8rem", fontWeight: 600,
                      color: "var(--on-surface)", lineHeight: 1.3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {ev.website
                        ? <a href={ev.website} target="_blank" rel="noopener noreferrer"
                            style={{ color: "inherit", textDecoration: "none" }}>{ev.event_name}</a>
                        : ev.event_name}
                    </p>
                    <span style={{ fontSize: "0.68rem", color: "var(--on-surface-variant)" }}>
                      {ev.venue}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
