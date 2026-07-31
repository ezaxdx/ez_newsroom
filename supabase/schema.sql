-- EZ Newsroom — 전체 스키마 (실제 운영 DB 기준 최신화)
-- 이 파일은 문서·재구축용 스냅샷입니다. idempotent(재실행 가능)하게 작성되어 있습니다.
-- 실제 운영 DB의 일부 컬럼은 세션 중 Supabase SQL Editor로 애드혹 추가되었다가
-- 여기 반영되었습니다 — 앞으로는 변경 시 이 파일도 함께 갱신해주세요.

-- ── news ──────────────────────────────────────────────────────────────
create table if not exists public.news (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  summary_short   text,
  content_long    text,
  implications    text,
  image_url       text,
  original_url    text not null,
  category        text not null,
  level           text default 'Intermediate',        -- Beginner|Intermediate|Advanced
  quality_score   integer,
  quality_criteria jsonb,                              -- {relevance,specificity,practicality,source_quality}
  priority_score  integer default 0,
  is_published    boolean default false,
  display_order   integer default 0,
  business_domains text[] default '{}',                 -- AI가 생성 시점에 직접 분류한 EZPMP 7대 사업영역 (키워드 사후매칭 대체)
  faithfulness_score integer,                            -- 원문 대비 충실도 재검증 점수(1~10) — audit-content 엣지함수가 채움
  faithfulness_issues jsonb,                             -- 재검증에서 발견된 문제점 목록 (할루시네이션·과장 등)
  audited_at      timestamptz,                           -- 콘텐츠 품질 재검증 실행 시각 (null이면 미감사)
  audit_dismissed_at timestamptz,                        -- 관리자가 "확인했으나 수정 안 함"으로 완료처리한 시각 — 감사 목록에서 제외
  published_at    timestamptz default now()
);

alter table public.news
  add column if not exists level            text default 'Intermediate',
  add column if not exists quality_score    integer,
  add column if not exists quality_criteria jsonb,
  add column if not exists business_domains text[] default '{}',
  add column if not exists faithfulness_score integer,
  add column if not exists faithfulness_issues jsonb,
  add column if not exists audited_at      timestamptz,
  add column if not exists audit_dismissed_at timestamptz;

-- original_url unique 제약 (news_original_url_unique) — 재발행 시 duplicate key 처리 기준
do $$ begin
  alter table public.news add constraint news_original_url_unique unique (original_url);
exception when duplicate_object then null;
end $$;

-- ── rss_sources ───────────────────────────────────────────────────────
create table if not exists public.rss_sources (
  id               uuid primary key default gen_random_uuid(),
  url              text not null unique,
  source_name      text not null,
  weight           integer default 1,
  default_category text not null,
  is_active        boolean default true,
  source_type      text default 'rss',   -- rss|url|api|gmail
  api_config       jsonb,                -- ApiConfig | GmailConfig
  keyword_filter   boolean default false -- true면 focus_keywords 매칭 기사만 수집 (언론사 전체피드용)
);

alter table public.rss_sources
  add column if not exists source_type    text default 'rss',
  add column if not exists api_config     jsonb,
  add column if not exists keyword_filter boolean default false;

-- ── curation_settings ─────────────────────────────────────────────────
create table if not exists public.curation_settings (
  id                    uuid primary key default gen_random_uuid(),
  target_audience       text,
  focus_keywords        text[],
  persona_prompt        text,
  nav_categories        text[] default array['AI','MICE','TOURISM'],
  carousel_interval_sec integer default 5,
  category_settings     jsonb default '{}',
  level_prompts         jsonb default '{}',            -- 레벨별(Beginner/Intermediate/Advanced) 작성 지침
  quality_thresholds    jsonb default '{"auto_publish": 8, "staging": 5}',
  auto_schedule         jsonb default '{"enabled": false, "days": [], "hour": 9}',
  company_context       text,
  business_domain_examples jsonb default '[]',   -- 관리자가 수동 보정한 사업영역 분류 예시 [{title, business_domains}] — 큐레이션 프롬프트의 few-shot 예시로 주입되어 이후 분류에 반영
  content_quality_notes jsonb default '[]',       -- 콘텐츠 품질 감사에서 발견되어 실제로 수정된 문제 유형 누적 — 큐레이션 프롬프트에 "이런 실수 반복하지 말 것"으로 주입
  newsletter_header_images jsonb default '[]'     -- 뉴스레터 헤더 배경 이미지 후보 [{label, url}] — "기본" 하나는 코드에 항상 고정 포함, 여기엔 이벤트용 등 추가분만 저장
);

alter table public.curation_settings
  add column if not exists nav_categories        text[] default array['AI','MICE','TOURISM'],
  add column if not exists carousel_interval_sec integer default 5,
  add column if not exists company_context       text,
  add column if not exists level_prompts         jsonb default '{}',
  add column if not exists quality_thresholds    jsonb default '{"auto_publish": 8, "staging": 5}',
  add column if not exists auto_schedule         jsonb default '{"enabled": false, "days": [], "hour": 9}',
  add column if not exists business_domain_examples jsonb default '[]',
  add column if not exists content_quality_notes jsonb default '[]',
  add column if not exists newsletter_header_images jsonb default '[]';

-- ── convention_events ─────────────────────────────────────────────────
create table if not exists public.convention_events (
  id             uuid primary key default gen_random_uuid(),
  venue          text not null,
  venue_region   text,
  event_name     text not null,
  event_name_en  text,
  start_date     date,
  end_date       date,
  location       text,
  category       text,
  industry       text,
  organizer      text,
  operator       text,        -- 정의만 있고 현재 코드 미사용 (레거시)
  website        text,
  image_url      text,
  description    text,        -- 뉴스레터용 AI 생성 설명, DB 캐시
  is_published   boolean default true,
  is_ezpmp_pick  boolean default false not null,  -- 어드민 수동 픽 — 자동 점수보다 최우선
  is_concurrent  boolean default false,           -- 동시개최 부속행사 (메인 행사 아님, 뉴스레터에서 제외)
  source         text default 'manual',           -- showala|keoa|manual
  created_at     timestamptz default now()
);

alter table public.convention_events
  add column if not exists image_url     text,
  add column if not exists description   text,
  add column if not exists is_ezpmp_pick boolean default false not null,
  add column if not exists is_concurrent boolean default false,
  add column if not exists source        text default 'manual';

do $$ begin
  alter table public.convention_events
    add constraint uq_event_name_start_date unique (event_name, start_date);
exception when duplicate_object then null;
end $$;

create index if not exists convention_events_start_date_idx on public.convention_events(start_date);
create index if not exists convention_events_venue_idx      on public.convention_events(venue);
create index if not exists convention_events_category_idx   on public.convention_events(category);

-- ── event_keyword_filters ─────────────────────────────────────────────
-- 행사 자동 비공개 키워드 (name: 행사명 매칭, industry: 전시분야 매칭)
create table if not exists public.event_keyword_filters (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null,
  memo        text,
  filter_type text not null default 'name',  -- name|industry
  created_at  timestamptz default now()
);

alter table public.event_keyword_filters
  add column if not exists filter_type text not null default 'name';

do $$ begin
  alter table public.event_keyword_filters
    add constraint uq_keyword_filter_type unique (keyword, filter_type);
exception when duplicate_object then null;
end $$;

-- ── user_logs ─────────────────────────────────────────────────────────
create table if not exists public.user_logs (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  news_id      uuid references public.news(id) on delete set null,
  event_id     uuid references public.convention_events(id) on delete set null,
  category     text,
  read_sec     numeric,
  search_query text,
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  entry_path   text,
  user_agent   text,
  via_deeplink boolean default false,
  newsletter_vol integer,  -- 뉴스레터 지난호 조회 로그 전용 — null이면 지난호 목록 페이지, 값이 있으면 해당 Vol 상세 페이지
  created_at   timestamptz default now()
);

alter table public.user_logs
  add column if not exists event_id     uuid references public.convention_events(id) on delete set null,
  add column if not exists category     text,
  add column if not exists read_sec     numeric,
  add column if not exists search_query text,
  add column if not exists via_deeplink boolean default false,
  add column if not exists newsletter_vol integer;

-- event_type check 제약 갱신 (read_time·search·category_view·session_time·newsletter_archive_view 추가 지원)
alter table public.user_logs drop constraint if exists user_logs_event_type_check;
alter table public.user_logs
  add constraint user_logs_event_type_check
  check (event_type in ('view','detail_view','outbound_click','event_click','read_time','search','category_view','session_time','newsletter_archive_view'));

-- ── gmail_tokens ──────────────────────────────────────────────────────
create table if not exists public.gmail_tokens (
  id            text primary key,  -- 'singleton' 고정값
  access_token  text,
  refresh_token text not null,
  expiry_date   bigint,
  updated_at    timestamptz default now()
);

-- ── scrape_logs ───────────────────────────────────────────────────────
-- 행사 스크래핑(scrape-events Edge Function) 실행 이력
create table if not exists public.scrape_logs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  ok               boolean not null default true,
  showala_scraped  integer,
  keoa_scraped     integer,
  inserted         integer,
  updated          integer,
  auto_hidden      integer,
  elapsed_sec      numeric,
  error            text
);

-- ── curation_logs ─────────────────────────────────────────────────────
-- 뉴스 큐레이션(curate Edge Function) 실행 이력
create table if not exists public.curation_logs (
  id           uuid primary key default gen_random_uuid(),
  run_at       timestamptz not null default now(),
  duration_ms  integer,
  fetched      integer,
  published    integer,
  staged       integer,
  skipped      integer,
  failed       integer,
  score_dist   jsonb,   -- {점수: 건수}
  source_stats jsonb,   -- [{name,type,fetched,published,staged,skipped,failed}]
  errors       jsonb    -- [{source,url?,error}]
);

-- ── newsletter_subscribers ────────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  name             text,
  is_active        boolean default true,
  created_at       timestamptz default now(),
  unsubscribed_at  timestamptz  -- 본인이 메일 내 "수신거부" 링크로 직접 해지한 시각 (관리자가 수동 비활성화한 경우는 null)
);

-- ── newsroom_popups ───────────────────────────────────────────────────
-- 뉴스룸 홈 진입 시 노출되는 팝업(이벤트 안내 등). 게시기간 + 사용여부 둘 다 만족해야 노출됨
create table if not exists public.newsroom_popups (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,          -- 관리용 식별명 (사용자에게 노출 안 됨)
  start_date  date not null,
  end_date    date not null,
  image_url   text,
  link_url    text,                   -- 클릭 시 이동할 주소 (구글폼 등). 없으면 클릭 불가
  content     text,                   -- 이미지 없이 텍스트만 띄우고 싶을 때
  is_active   boolean default true not null,
  display_type text default 'modal' not null,        -- modal(가운데 팝업·닫기 가능) | floating(구석 고정·상시 노출)
  position     text default 'bottom-right' not null, -- 3×3 위치(top/middle/bottom-left/center/right) 또는 random
  pages        jsonb default '["home"]' not null,    -- 노출 페이지: home|category|events|archive
  random_page  boolean default false not null,       -- true면 pages 중 한 곳에만 랜덤 노출(숨은그림찾기용)
  hunt_code    text,                                 -- 값이 있으면 '찾기 이벤트' 대상 — 클릭 시 링크 대신 이 코드를 보여주고 사라짐
  size_px      integer,                               -- 폭(px). null이면 표시 방식별 기본값(고정 150 / 팝업 420) 사용
  pos_x        numeric,                                -- position='custom'일 때만 사용 — 화면 미리보기를 클릭해 찍은 위치(%)
  pos_y        numeric,
  created_at  timestamptz default now()
);
create index if not exists idx_newsroom_popups_period on public.newsroom_popups (start_date, end_date);
alter table public.newsroom_popups add column if not exists display_type text default 'modal' not null;
alter table public.newsroom_popups add column if not exists position text default 'bottom-right' not null;
alter table public.newsroom_popups add column if not exists pages jsonb default '["home"]' not null;
alter table public.newsroom_popups add column if not exists random_page boolean default false not null;
alter table public.newsroom_popups add column if not exists hunt_code text;
alter table public.newsroom_popups add column if not exists size_px integer;
alter table public.newsroom_popups add column if not exists pos_x numeric;
alter table public.newsroom_popups add column if not exists pos_y numeric;

-- ── newsroom_event_settings ───────────────────────────────────────────
-- 숨은 그림(고양이) 찾기 이벤트 전역 설정. 단일 행으로만 사용
create table if not exists public.newsroom_event_settings (
  id         uuid primary key default gen_random_uuid(),
  enabled    boolean default false not null,  -- 꺼두면 진행률·응모 버튼이 아예 노출되지 않음
  title      text default '숨은 고양이를 찾아라' not null,
  form_url   text,                            -- 응모 구글폼 주소
  updated_at timestamptz default now()
);

-- ── newsletter_subscriber_snapshots ───────────────────────────────────
-- 매달 명단을 전체 삭제 후 재업로드하는 운영 방식 때문에 unsubscribed_at 이력이 사라짐 —
-- 전체 삭제 직전 총원/수신거부 인원을 한 줄 남겨서 기수별 추세를 보존
create table if not exists public.newsletter_subscriber_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  snapshot_date        date default current_date,
  total_count          integer not null,
  unsubscribed_count   integer not null,
  unsubscribed_emails  jsonb default '[]',  -- [{email, name, unsubscribed_at}] — 삭제 직전 명단이라 이 시점 아니면 유실됨. UI엔 아직 미노출
  created_at           timestamptz default now()
);
alter table public.newsletter_subscriber_snapshots add column if not exists unsubscribed_emails jsonb default '[]';

-- ── newsletter_issues ─────────────────────────────────────────────────
create table if not exists public.newsletter_issues (
  id                 uuid primary key default gen_random_uuid(),
  vol_number         integer not null,
  editorial_text     text,
  status             text default 'sending',  -- sending|sent|partial|failed
  html_content       text,
  target_count       integer default 0,
  total_sent         integer default 0,
  total_failed       integer default 0,
  featured_event_ids jsonb,  -- uuid[] as jsonb
  sent_at            timestamptz,
  created_at         timestamptz default now()
);

-- ── newsletter_send_logs ──────────────────────────────────────────────
create table if not exists public.newsletter_send_logs (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid references public.newsletter_issues(id) on delete cascade,
  email         text not null,
  status        text not null,  -- success|failed
  error_message text,
  sent_at       timestamptz default now(),
  opened_at     timestamptz  -- 최초 열람 시각만 기록 (트래킹 픽셀, 재오픈은 갱신 안 함)
);

-- ── newsletter_cron_settings ──────────────────────────────────────────
create table if not exists public.newsletter_cron_settings (
  id                uuid primary key default gen_random_uuid(),
  enabled           boolean default false,
  send_day          integer,               -- 레거시 단일 요일 (send_days로 대체됨)
  send_days         integer[] default '{2,4}',
  send_hour         integer default 10,
  default_editorial text,
  updated_at        timestamptz default now(),
  created_at        timestamptz default now()
);

alter table public.newsletter_cron_settings
  add column if not exists send_days integer[] default '{2,4}';

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.news                      enable row level security;
alter table public.rss_sources               enable row level security;
alter table public.curation_settings         enable row level security;
alter table public.convention_events         enable row level security;
alter table public.event_keyword_filters     enable row level security;
alter table public.user_logs                 enable row level security;
alter table public.gmail_tokens              enable row level security;
alter table public.scrape_logs               enable row level security;
alter table public.curation_logs             enable row level security;
alter table public.newsletter_subscribers    enable row level security;
alter table public.newsletter_subscriber_snapshots enable row level security;
alter table public.newsroom_popups           enable row level security;
alter table public.newsroom_event_settings   enable row level security;
alter table public.newsletter_issues         enable row level security;
alter table public.newsletter_send_logs      enable row level security;
alter table public.newsletter_cron_settings  enable row level security;

-- drop before recreate to avoid "already exists" on re-run
drop policy if exists "public read published news"     on public.news;
drop policy if exists "public insert user_logs"        on public.user_logs;
drop policy if exists "admin all news"                 on public.news;
drop policy if exists "admin all rss_sources"          on public.rss_sources;
drop policy if exists "admin all curation_settings"    on public.curation_settings;
drop policy if exists "admin read user_logs"           on public.user_logs;
drop policy if exists "public read curation_settings"  on public.curation_settings;
drop policy if exists "admin all gmail_tokens"         on public.gmail_tokens;
drop policy if exists "public read convention_events"  on public.convention_events;
drop policy if exists "admin all convention_events"    on public.convention_events;
drop policy if exists "admin all event_keyword_filters" on public.event_keyword_filters;
drop policy if exists "admin all scrape_logs"          on public.scrape_logs;
drop policy if exists "admin all curation_logs"        on public.curation_logs;
drop policy if exists "admin all newsletter_subscribers" on public.newsletter_subscribers;
drop policy if exists "admin all newsletter_subscriber_snapshots" on public.newsletter_subscriber_snapshots;
drop policy if exists "public read newsroom_popups" on public.newsroom_popups;
drop policy if exists "admin all newsroom_popups" on public.newsroom_popups;
drop policy if exists "public read newsroom_event_settings" on public.newsroom_event_settings;
drop policy if exists "admin all newsroom_event_settings" on public.newsroom_event_settings;
drop policy if exists "admin all newsletter_issues"    on public.newsletter_issues;
drop policy if exists "admin all newsletter_send_logs" on public.newsletter_send_logs;
drop policy if exists "admin all newsletter_cron_settings" on public.newsletter_cron_settings;

create policy "public read published news"
  on public.news for select
  using (is_published = true);

create policy "public read curation_settings"
  on public.curation_settings for select
  using (true);

create policy "public read convention_events"
  on public.convention_events for select
  using (is_published = true);

create policy "public insert user_logs"
  on public.user_logs for insert
  with check (true);

create policy "admin all news"
  on public.news for all
  using (auth.role() = 'authenticated');

create policy "admin all rss_sources"
  on public.rss_sources for all
  using (auth.role() = 'authenticated');

create policy "admin all curation_settings"
  on public.curation_settings for all
  using (auth.role() = 'authenticated');

create policy "admin all convention_events"
  on public.convention_events for all
  using (auth.role() = 'authenticated');

create policy "admin all event_keyword_filters"
  on public.event_keyword_filters for all
  using (auth.role() = 'authenticated');

create policy "admin read user_logs"
  on public.user_logs for select
  using (auth.role() = 'authenticated');

create policy "admin all gmail_tokens"
  on public.gmail_tokens for all
  using (auth.role() = 'authenticated');

create policy "admin all scrape_logs"
  on public.scrape_logs for all
  using (auth.role() = 'authenticated');

create policy "admin all curation_logs"
  on public.curation_logs for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_subscribers"
  on public.newsletter_subscribers for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_subscriber_snapshots"
  on public.newsletter_subscriber_snapshots for all
  using (auth.role() = 'authenticated');

create policy "public read newsroom_popups"
  on public.newsroom_popups for select
  using (true);

create policy "admin all newsroom_popups"
  on public.newsroom_popups for all
  using (auth.role() = 'authenticated');

create policy "public read newsroom_event_settings"
  on public.newsroom_event_settings for select
  using (true);

create policy "admin all newsroom_event_settings"
  on public.newsroom_event_settings for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_issues"
  on public.newsletter_issues for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_send_logs"
  on public.newsletter_send_logs for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_cron_settings"
  on public.newsletter_cron_settings for all
  using (auth.role() = 'authenticated');
