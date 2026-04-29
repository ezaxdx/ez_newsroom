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
  priority_score  integer default 0,
  is_published    boolean default false,
  display_order   integer default 0,
  published_at    timestamptz default now()
);

-- ── rss_sources ───────────────────────────────────────────────────────
create table if not exists public.rss_sources (
  id               uuid primary key default gen_random_uuid(),
  url              text not null unique,
  source_name      text not null,
  weight           integer default 1,
  default_category text not null,
  is_active        boolean default true
);

-- ── curation_settings ─────────────────────────────────────────────────
create table if not exists public.curation_settings (
  id                    uuid primary key default gen_random_uuid(),
  target_audience       text,
  focus_keywords        text[],
  persona_prompt        text,
  nav_categories        text[] default array['AI','MICE','TOURISM'],
  carousel_interval_sec integer default 5,
  category_settings     jsonb  default '{}'
);

-- ── user_logs ─────────────────────────────────────────────────────────
create table if not exists public.user_logs (
  id           uuid primary key default gen_random_uuid(),
  event_type   text check (event_type in ('view','detail_view','outbound_click')),
  news_id      uuid references public.news(id) on delete set null,
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  entry_path   text,
  user_agent   text,
  created_at   timestamptz default now()
);

-- ── curation_settings 컬럼 마이그레이션 (이미 테이블 있을 때) ──────────
alter table public.curation_settings
  add column if not exists nav_categories        text[] default array['AI','MICE','TOURISM'],
  add column if not exists carousel_interval_sec integer default 5;

-- ── gmail_tokens ──────────────────────────────────────────────────────
create table if not exists public.gmail_tokens (
  id            text primary key,  -- 'singleton' 고정값
  access_token  text,
  refresh_token text not null,
  expiry_date   bigint,
  updated_at    timestamptz default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.news            enable row level security;
alter table public.rss_sources     enable row level security;
alter table public.curation_settings enable row level security;
alter table public.user_logs       enable row level security;
alter table public.gmail_tokens    enable row level security;

-- drop before recreate to avoid "already exists" on re-run
drop policy if exists "public read published news"   on public.news;
drop policy if exists "public insert user_logs"      on public.user_logs;
drop policy if exists "admin all news"               on public.news;
drop policy if exists "admin all rss_sources"        on public.rss_sources;
drop policy if exists "admin all curation_settings"  on public.curation_settings;
drop policy if exists "admin read user_logs"         on public.user_logs;
drop policy if exists "public read curation_settings" on public.curation_settings;
drop policy if exists "admin all gmail_tokens"        on public.gmail_tokens;

create policy "public read published news"
  on public.news for select
  using (is_published = true);

create policy "public read curation_settings"
  on public.curation_settings for select
  using (true);

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

create policy "admin read user_logs"
  on public.user_logs for select
  using (auth.role() = 'authenticated');

create policy "admin all gmail_tokens"
  on public.gmail_tokens for all
  using (auth.role() = 'authenticated');
