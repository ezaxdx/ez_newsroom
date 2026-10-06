-- 06_event_changes.sql — 행사 수집 변경 내역 (신규 · 일정 변경 의심 · 사라진 행사 · 값 변경)
-- 실행: Supabase SQL Editor. 새 테이블 1개 + 컬럼 1개 추가뿐이라 기존 동작에 영향 없음.
-- 이 SQL 을 실행하기 전에는 수집 함수가 변경 감지 없이(기존 방식으로) 동작함.

-- 1) 행사별 "각 소스에서 마지막으로 확인된 시각" — 소스 목록에서 사라진 행사를 찾는 데 사용
--    예: {"akei":"2026-10-07T00:00:12Z","keoa":"2026-10-07T00:00:40Z"}
alter table public.convention_events
  add column if not exists seen_at jsonb not null default '{}'::jsonb;

-- 2) 변경 내역 = 검토 대기열 + 처리 이력 (한 테이블)
create table if not exists public.event_changes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  kind        text not null,                  -- new | date_suspect | field_change | missing
  status      text not null default 'pending',-- pending | applied | dismissed | reverted
  resolution  text,                           -- date_changed | separate | applied | kept | hidden | acknowledged | reverted
  event_id    uuid references public.convention_events(id) on delete cascade,
  source      text,                           -- akei | keoa | showala
  dedupe_key  text not null unique,           -- 같은 변경을 다음 수집에서 다시 묻지 않도록 (예: date|<행사id>|<새 시작일>)
  payload     jsonb not null default '{}'::jsonb  -- 옛 값·새 값·후보 행사 등
);

create index if not exists event_changes_status_kind_idx on public.event_changes (status, kind);
create index if not exists event_changes_event_idx       on public.event_changes (event_id);

alter table public.event_changes enable row level security;
drop policy if exists "admin all event_changes" on public.event_changes;
create policy "admin all event_changes"
  on public.event_changes for all
  using (auth.role() = 'authenticated');
