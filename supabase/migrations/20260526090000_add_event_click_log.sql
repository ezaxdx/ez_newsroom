-- user_logs: event_id 컬럼 추가 + event_click 이벤트 타입 허용
alter table public.user_logs
  add column if not exists event_id uuid references public.convention_events(id) on delete set null;

-- check constraint 재정의 (event_click 추가)
alter table public.user_logs
  drop constraint if exists user_logs_event_type_check;

alter table public.user_logs
  add constraint user_logs_event_type_check
    check (event_type in ('view', 'detail_view', 'outbound_click', 'event_click'));
