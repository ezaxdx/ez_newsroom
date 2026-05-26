# EZ Newsroom Phase 2 — 전체 설계 문서

> 작성일: 2026-05-22  
> 대상: 개발팀 / AXDX팀 내부용

---

## 1. 전체 제품 비전

```
[AI 큐레이션 뉴스] ← 현재 운영 중
        +
[EZPMP 행사 달력]  ← Phase 2-A
        +
[이 행사 어때요?]  ← Phase 2-B (AI 매칭)
        ↓
[뉴스레터 이메일 발송] ← Phase 2-C
        ↓
[EZPMP 홈페이지 / 뉴스룸 유입]
```

---

## 2. Phase 2-A — 행사 달력 & 리스트 페이지

### 2-A-1. 페이지 구조

**URL:** `/events` (공개 페이지)

```
/events
├── 상단: 월별 캘린더 뷰 (클릭하면 해당 날짜 행사 하이라이트)
├── 중단: 행사 리스트 (카드형)
│   ├── 필터: 연도 | 행사분류 | 산업분류 | 사업부
│   └── 각 카드: 행사명 / 날짜 / 발주처 / 분류 태그
└── 하단: "이 행사 어때요?" 추천 섹션 (Phase 2-B)
```

### 2-A-2. 데이터 소스

- **내부 데이터**: EZPMP 과거 행사 이력 (CSV → DB 임포트, 181건)
- **향후 확장**: 외부 행사 공고 수집 (공공데이터포털 API, RSS 크롤링)

### 2-A-3. DB 스키마

```sql
-- EZPMP 내부 행사 이력
create table public.ezpmp_events (
  id            uuid primary key default gen_random_uuid(),
  no            integer,
  division      text,          -- PM 사업부 (컨벤션/E&E/MICE/기획사업/ESG)
  team          text,          -- PM 부서명
  project_name  text not null, -- 프로젝트명 (행사명)
  year          integer,
  start_date    date,
  end_date      date,
  client        text,          -- 발주처 ★ AI 매칭 핵심
  event_type    text,          -- 행사분류 (국제회의/전시회/포럼/박람회 등)
  industry      text,          -- 산업분류 (IT/의료/관광/스포츠 등)
  host_org      text,          -- 주최기관
  organizer     text,          -- 주관기관
  overview      text,          -- 사업개요
  tags          text[],        -- 연관어 (파싱)
  is_public     boolean default true,  -- 공개 여부 (관리자 제어)
  created_at    timestamptz default now()
);

create index on public.ezpmp_events(client);
create index on public.ezpmp_events(industry);
create index on public.ezpmp_events(event_type);
create index on public.ezpmp_events(year);
create index on public.ezpmp_events(start_date);

-- 외부 행사 공고 (Phase 2-B 수집용)
create table public.external_events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  event_date      date,
  end_date        date,
  organizer       text,
  industry        text,
  description     text,
  source_url      text,
  source_name     text,       -- 수집 출처 (공공데이터포털, KINTEX 등)
  match_score     integer,    -- AI 매칭 점수 (0-10)
  match_reason    text,       -- AI 매칭 이유
  is_recommended  boolean default false,
  collected_at    timestamptz default now()
);
```

### 2-A-4. 관리자 페이지

**URL:** `/admin/events`

- CSV 일괄 임포트 버튼
- 행사 목록 테이블 (수정/삭제/공개여부 토글)
- 수동 행사 추가 폼

---

## 3. Phase 2-B — "이 행사 어때요?" AI 매칭

### 개념

외부 행사 공고를 수집해서 EZPMP의 과거 행사 이력과 비교,  
**"우리가 잘 하는 분야의 새 행사"** 를 자동 발견하여 추천

### 매칭 로직 (Gemini AI)

```
INPUT:
  - 외부 행사 정보 (제목, 주최, 분류, 설명)
  - EZPMP 과거 행사 이력 요약 (발주처 목록, 산업분류 분포, 행사유형 비중)
  - company_context (settings에 저장된 회사 정보)

OUTPUT:
  - match_score: 0-10 (10 = 매우 연관)
  - match_reason: "한국관광공사와 3회 협업 이력, 관광 분야 행사"
  - is_recommended: true/false (score >= 6)
```

### 매칭 기준 (AI 판단 요소)

| 기준 | 설명 | 가중치 |
|------|------|--------|
| 발주처 동일 | 과거에 같은 기관과 일한 적 있음 | 높음 |
| 발주처 계열 | 산하기관, 협회 등 연관 기관 | 중간 |
| 산업분류 일치 | 동일한 industry 카테고리 | 중간 |
| 행사유형 일치 | 국제회의/전시회 등 우리가 주로 하는 유형 | 중간 |
| 규모/키워드 | 사업개요 키워드 유사도 | 낮음 |

### 데이터 수집 방법 (후보)

1. **공공데이터포털** — 전시/컨벤션 행사 공고 API
2. **MICE 협회 사이트** — RSS 또는 크롤링
3. **KINTEX / COEX / 벡스코** 사이트 행사 일정
4. **각 부처 보도자료** — 행사 개최 예고

> 1단계는 수동 입력도 가능. 관리자가 외부 행사를 직접 등록하면 AI가 점수 매기는 방식으로 시작.

---

## 4. Phase 2-C — 뉴스레터 이메일 발송

### 4-1. 개념

**뉴스룸 UI = 이메일 레이아웃** (동일한 시각적 구성)

```
뉴스룸 웹페이지 (React)
    ↓ 동일 데이터, HTML 이메일 템플릿으로 렌더링
뉴스레터 이메일
    ↓ 모든 링크 = 뉴스룸 또는 EZPMP 홈페이지로 연결
구독자 수신 → 클릭 → 유입
```

### 4-2. 이메일 구성 (섹션)

```
[EZPMP EZ Newsroom 뉴스레터]
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📰 이번 주 주요 뉴스 (AI 큐레이션 상위 3-5건)
   ├── 뉴스 제목 + 요약 + [자세히 보기 →] 링크
   └── 각 항목 클릭 → 원문 기사 or 뉴스룸 상세

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 이달의 행사 캘린더 (upcoming)
   ├── 날짜 | 행사명 | 분류 태그
   └── [전체 행사 보기 →] 링크 → /events

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 이 행사 어때요? (AI 추천)
   ├── 추천 외부 행사 1-3건
   ├── 매칭 이유 한 줄 설명
   └── [행사 정보 보기 →] 링크

━━━━━━━━━━━━━━━━━━━━━━━━━━━
[EZPMP 홈페이지 바로가기] [뉴스레터 구독 취소]
```

### 4-3. 기술 스택 옵션

| 옵션 | 장점 | 단점 |
|------|------|------|
| **React Email** | 기존 React 컴포넌트와 일관성 | 초기 설정 필요 |
| **MJML** | 이메일 호환성 최고 | 별도 문법 학습 |
| **직접 HTML** | 단순함 | 유지보수 번거로움 |

**→ 추천: React Email** (`react-email` + `@react-email/components`)  
기존 Next.js 프로젝트에 자연스럽게 통합, Vercel에서 빌드 가능

### 4-4. 발송 방식

**기존 Gmail API 활용 (이미 연결됨)**
- 장점: 별도 서비스 불필요, 현재 인프라 재활용
- 단점: 대량 발송 한계 (하루 500건)

**Resend API (추천 - 대량 발송시)**
- React Email과 공식 통합
- 월 100건 무료, 이후 저렴한 유료 플랜
- 발송 로그, 오픈율 트래킹 포함
- 구독자 관리(구독/취소) 내장

### 4-5. 구독자 관리 DB

```sql
create table public.newsletter_subscribers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text,
  company       text,
  subscribed_at timestamptz default now(),
  unsubscribed_at timestamptz,
  is_active     boolean default true
);
```

### 4-6. 발송 스케줄

- **주간 뉴스레터**: 매주 월요일 오전 9시 (Vercel Cron)
- 또는 **관리자 수동 발송**: 버튼 클릭으로 즉시 발송
- 이번 주 AI 큐레이션 뉴스 상위 N건 자동 선별

---

## 5. 전체 구현 로드맵

### Phase 2-A: 행사 달력 & 리스트 (1순위)

```
Step 1. DB 마이그레이션 — ezpmp_events 테이블 생성
Step 2. CSV 임포트 스크립트 — 181건 데이터 삽입
Step 3. /admin/events 관리자 페이지 (리스트 + 공개여부 토글)
Step 4. /events 공개 페이지 — 캘린더 + 카드 리스트
Step 5. 필터링 (연도/분류/산업)
```

### Phase 2-B: AI 행사 추천 (2순위)

```
Step 6. external_events 테이블 생성
Step 7. 관리자에서 외부 행사 수동 등록 + AI 매칭 점수 계산
Step 8. /events 하단에 "이 행사 어때요?" 섹션 추가
Step 9. (선택) 자동 수집 크롤러/API 연결
```

### Phase 2-C: 뉴스레터 (3순위)

```
Step 10. newsletter_subscribers 테이블 + 구독 폼
Step 11. React Email 템플릿 제작 (뉴스 + 행사 + 추천 섹션)
Step 12. Resend API 연결
Step 13. 발송 Edge Function + Vercel Cron 스케줄
Step 14. 관리자 수동 발송 버튼
Step 15. 구독 취소 처리 (원클릭 unsubscribe)
```

---

## 6. 의존 관계 요약

```
CSV 데이터 (181건)
    ↓ 임포트
ezpmp_events (DB)
    ↓ 활용
/events 공개 페이지 + AI 매칭 컨텍스트
    ↓ UI 완성 후
React Email 템플릿 (동일 데이터)
    ↓
뉴스레터 발송 → 홈페이지 유입
```

---

## 7. 기술 스택 추가 사항 (Phase 2)

| 항목 | 라이브러리/서비스 |
|------|-----------------|
| 캘린더 UI | `react-calendar` 또는 커스텀 그리드 |
| 이메일 템플릿 | `react-email` + `@react-email/components` |
| 이메일 발송 | `resend` (API) |
| CSV 임포트 | Node.js `papaparse` 또는 직접 파싱 스크립트 |
| 외부 행사 수집 | `cheerio` (크롤링) 또는 공공API fetch |
