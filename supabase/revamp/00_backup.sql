-- ============================================================================
-- [0단계] 큐레이션 개편 전 백업 — 바뀔 수 있는 테이블 3개를 통째로 복사
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run
-- 여러 번 실행해도 기존 백업을 덮어쓰지 않음 (이미 있으면 건너뜀)
-- 복원: 99_restore.sql 참고
-- ============================================================================

create table if not exists public.backup_20261006_rss_sources       as select * from public.rss_sources;
create table if not exists public.backup_20261006_curation_settings as select * from public.curation_settings;
create table if not exists public.backup_20261006_convention_events as select * from public.convention_events;

-- 백업 테이블은 public 스키마라 그대로 두면 익명 키로 조회될 수 있음.
-- RLS를 켜고 정책을 만들지 않아 service role(서버)만 접근 가능하게 잠금.
alter table public.backup_20261006_rss_sources       enable row level security;
alter table public.backup_20261006_curation_settings enable row level security;
alter table public.backup_20261006_convention_events enable row level security;

-- 확인용: 원본과 백업의 행 수가 같아야 함
select 'rss_sources' as tbl,
       (select count(*) from public.rss_sources)                  as original,
       (select count(*) from public.backup_20261006_rss_sources) as backup
union all
select 'curation_settings',
       (select count(*) from public.curation_settings),
       (select count(*) from public.backup_20261006_curation_settings)
union all
select 'convention_events',
       (select count(*) from public.convention_events),
       (select count(*) from public.backup_20261006_convention_events);
