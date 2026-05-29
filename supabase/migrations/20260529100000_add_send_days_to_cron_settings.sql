-- newsletter_cron_settings에 send_days 배열 컬럼 추가 (주 다회 발송 지원)
alter table public.newsletter_cron_settings
  add column if not exists send_days integer[] default '{2,4}';

-- 기존 send_day 값이 있으면 send_days로 마이그레이션
update public.newsletter_cron_settings
  set send_days = array[send_day]
  where send_days is null and send_day is not null;

-- 기본 send_hour도 10시로 업데이트 (기존 9시 → 10시)
update public.newsletter_cron_settings
  set send_hour = 10
  where send_hour = 9;
