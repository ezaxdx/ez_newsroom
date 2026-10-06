-- 07_events_ui.sql — 행사 관리 UI 개편 (동시개최 연결 · 비공개 사유 · 규칙 예외)
-- 실행: Supabase SQL Editor. 컬럼·테이블 추가뿐이라 기존 동작에 영향 없음.

-- 1) 동시개최 연결: 대표 행사를 가리키는 컬럼 (is_concurrent=true 인 행이 대표 행사의 id 를 가짐)
alter table public.convention_events
  add column if not exists parent_event_id uuid references public.convention_events(id) on delete set null;
create index if not exists convention_events_parent_idx
  on public.convention_events (parent_event_id) where parent_event_id is not null;

-- 2) 비공개 사유 — manual(관리자) | rule(자동 규칙) | missing(소스에서 사라짐). 기존 비공개 행은 비어 있음(수동·기존으로 표시)
alter table public.convention_events
  add column if not exists hidden_reason text;

-- 3) 수집 이력: 규칙별 제외 건수 {"행사명:베이비": 8, "분야:교육": 3}
alter table public.scrape_logs
  add column if not exists dropped_by_rule jsonb;

-- 4) "제외하지 않기" 예외 — 규칙에 걸려도 수집하도록 허용한 행사 (이름을 정규화한 키)
create table if not exists public.event_filter_exceptions (
  id          uuid primary key default gen_random_uuid(),
  name_key    text not null unique,
  event_name  text,
  created_at  timestamptz not null default now()
);
alter table public.event_filter_exceptions enable row level security;
drop policy if exists "admin all event_filter_exceptions" on public.event_filter_exceptions;
create policy "admin all event_filter_exceptions"
  on public.event_filter_exceptions for all
  using (auth.role() = 'authenticated');
