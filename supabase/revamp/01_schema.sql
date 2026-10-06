-- ============================================================================
-- [1단계] 큐레이션 개편 DB 구조 변경 — 컬럼·테이블 "추가만" (기존 컬럼 변경·삭제 없음)
-- 실행: 00_backup.sql 을 먼저 실행한 뒤, SQL Editor 에 붙여넣고 Run
-- 여러 번 실행해도 안전 (if not exists / drop policy if exists)
-- 기존 curate 함수는 이 컬럼들을 모르므로 이 SQL 실행만으로 기존 동작은 바뀌지 않음
-- ============================================================================

begin;

-- ── rss_sources: 수집 소스 설정 확장 ──────────────────────────────────────
-- source_type 새 값 (※ 운영 DB 에는 rss_sources_source_type_check 제약이 있어, 02_cutover.sql 0단계에서 아래 값으로 넓힘 — 이 파일에서는 제약을 건드리지 않음):
--   기존 rss | url | api | gmail | naver_news
--   신규 keyword_search(검색 키워드, 엔진은 fetch_config.engines) | web_list(웹페이지 목록) | json_list(JSON API)
-- default_category 는 기존 값 그대로 쓰고, 신규로 'MIXED'(섞여 있음 → AI 판단) 허용
alter table public.rss_sources
  add column if not exists keyword_mode    text    default 'none',   -- none(전체) | default(기본 관심 키워드) | custom(지정 키워드)
  add column if not exists custom_keywords text[]  default '{}',     -- keyword_mode='custom' 일 때 이 소스만 쓰는 키워드
  add column if not exists max_items       integer default 10,       -- 1회 실행 최대 건수 (기존엔 코드에 10으로 고정)
  add column if not exists fetch_config    jsonb   default '{}',     -- 요청 방식·Referer·렌더링 여부·JSON 필드 매핑·검색 엔진 등
  add column if not exists last_run_at     timestamptz,              -- 최근 수집 시도 시각
  add column if not exists last_status     text,                     -- ok | empty | error | not_run
  add column if not exists last_fetched    integer,                  -- 최근 실행에서 수집된 후보 수
  add column if not exists zero_streak     integer default 0,        -- 연속 0건 횟수 (경고 기준)
  add column if not exists last_error      text,                     -- 최근 오류 요약 (401·404·연결 실패 등)
  add column if not exists last_alerted_at timestamptz;              -- 같은 문제를 하루 한 번만 알리기 위한 기록

-- ── curation_settings: 카테고리 힌트·확정 예시 ────────────────────────────
alter table public.curation_settings
  add column if not exists category_hints   jsonb default '{}',      -- AI 판단 시 참고 키워드 {MICE:{strong:[],weak:[]}, ...}
  add column if not exists category_examples jsonb default '[]';     -- 관리자가 고친 카테고리 사례 [{title, category}] — few-shot 예시

-- ── convention_events: 이즈픽 행사 뉴스 검색어 ────────────────────────────
alter table public.convention_events
  add column if not exists news_keywords text[] default '{}';        -- 행사명 외 별칭 (예: KME, 코리아마이스엑스포)

-- ── news: 중복 묶기·행사 연결·카테고리 근거 ───────────────────────────────
alter table public.news
  add column if not exists original_title   text,                    -- 원문 제목 (중복 판정용. title 은 AI가 다시 쓴 제목)
  add column if not exists found_via        text[]  default '{}',    -- 어디서 발견됐는지 {naver, google, rss:소스명 ...}
  add column if not exists coverage_count   integer default 1,       -- 같은 내용을 다룬 매체 수 (노출 가산점)
  add column if not exists related_event_id uuid references public.convention_events(id) on delete set null,
  add column if not exists category_reason  text,                    -- AI가 카테고리를 판단한 경우의 한 줄 근거
  add column if not exists category_edited  boolean default false;   -- 관리자가 카테고리를 직접 고친 기사

create index if not exists news_related_event_idx
  on public.news (related_event_id) where related_event_id is not null;

-- ── curation_logs: 시험 실행 구분 ─────────────────────────────────────────
alter table public.curation_logs
  add column if not exists run_mode text  default 'live',            -- live(정기 실행) | dry(시험 실행: 기사 저장 안 함)
  add column if not exists details  jsonb;                           -- 시험 실행 결과(후보·건너뜀 사유·예상 카테고리 등)

-- ── 신규: news_original_text (관리자 전용) ────────────────────────────────
-- 원문 최대 6000자. news 에 넣으면 "발행 기사 공개 읽기" 정책 때문에 익명 키로 조회되므로 별도 테이블로 분리.
create table if not exists public.news_original_text (
  news_id       uuid primary key references public.news(id) on delete cascade,
  original_text text not null,
  fetched_at    timestamptz default now()
);

-- ── 신규: curation_seen (건너뛴·폐기한 URL 기록) ──────────────────────────
-- 같은 기사를 매 실행마다 다시 긁지 않기 위한 기록 (정규화한 URL 기준)
create table if not exists public.curation_seen (
  url_key       text primary key,                                    -- 정규화한 URL
  original_url  text,
  reason        text not null,                                       -- too_old | too_short | low_score | low_fit | duplicate | off_topic | fetch_failed
  source_name   text,
  title         text,
  seen_at       timestamptz default now()
);
create index if not exists curation_seen_seen_at_idx on public.curation_seen (seen_at);

-- ── RLS (service role 은 RLS 를 우회하므로 서버 함수는 영향 없음) ──────────
alter table public.news_original_text enable row level security;
alter table public.curation_seen      enable row level security;

drop policy if exists "admin all news_original_text" on public.news_original_text;
drop policy if exists "admin all curation_seen"      on public.curation_seen;

create policy "admin all news_original_text"
  on public.news_original_text for all
  using (auth.role() = 'authenticated');

create policy "admin all curation_seen"
  on public.curation_seen for all
  using (auth.role() = 'authenticated');

commit;

-- 확인용: 새로 생긴 컬럼 수 (rss_sources 10, curation_settings 2, convention_events 1, news 6, curation_logs 2 = 21)
select table_name, count(*) as added_columns
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'rss_sources'       and column_name in ('keyword_mode','custom_keywords','max_items','fetch_config','last_run_at','last_status','last_fetched','zero_streak','last_error','last_alerted_at')) or
    (table_name = 'curation_settings' and column_name in ('category_hints','category_examples')) or
    (table_name = 'convention_events' and column_name = 'news_keywords') or
    (table_name = 'news'              and column_name in ('original_title','found_via','coverage_count','related_event_id','category_reason','category_edited')) or
    (table_name = 'curation_logs'     and column_name in ('run_mode','details'))
  )
group by table_name
order by table_name;
