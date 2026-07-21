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
  published_at    timestamptz default now()
);

alter table public.news
  add column if not exists level            text default 'Intermediate',
  add column if not exists quality_score    integer,
  add column if not exists quality_criteria jsonb;

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
  company_context       text
);

alter table public.curation_settings
  add column if not exists nav_categories        text[] default array['AI','MICE','TOURISM'],
  add column if not exists carousel_interval_sec integer default 5,
  add column if not exists company_context       text,
  add column if not exists level_prompts         jsonb default '{}',
  add column if not exists quality_thresholds    jsonb default '{"auto_publish": 8, "staging": 5}',
  add column if not exists auto_schedule         jsonb default '{"enabled": false, "days": [], "hour": 9}';

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
  created_at   timestamptz default now()
);

alter table public.user_logs
  add column if not exists event_id     uuid references public.convention_events(id) on delete set null,
  add column if not exists category     text,
  add column if not exists read_sec     numeric,
  add column if not exists search_query text;

-- event_type check 제약 갱신 (read_time·search·category_view 추가 지원)
alter table public.user_logs drop constraint if exists user_logs_event_type_check;
alter table public.user_logs
  add constraint user_logs_event_type_check
  check (event_type in ('view','detail_view','outbound_click','event_click','read_time','search','category_view'));

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
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  is_active  boolean default true,
  created_at timestamptz default now()
);

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
  sent_at       timestamptz default now()
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

create policy "admin all newsletter_issues"
  on public.newsletter_issues for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_send_logs"
  on public.newsletter_send_logs for all
  using (auth.role() = 'authenticated');

create policy "admin all newsletter_cron_settings"
  on public.newsletter_cron_settings for all
  using (auth.role() = 'authenticated');
