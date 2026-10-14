-- 큐레이션 워치독 (DB 쪽 감시) — Vercel 크론·Edge 함수와 무관하게 돌아서 "크론이 안 뜬 경우"와 "도중에 서버가 죽은 경우"를 즉시 디스코드로 알림
-- 실행 순서: Supabase SQL Editor에서 이 파일 전체 실행 → 맨 아래 "웹훅 등록" 한 줄에 실제 URL을 넣어 실행
-- 필요 확장: pg_cron, pg_net (Dashboard > Database > Extensions 에서 켜져 있어야 함. 아래 create extension이 권한 오류면 대시보드에서 켜기)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 디스코드 전송 (웹훅 URL은 Vault 시크릿 'discord_webhook_url'에서 읽음 — 코드·테이블에 평문으로 안 남김)
create or replace function public.watchdog_discord(p_title text, p_text text) returns void
language plpgsql security definer set search_path = public, extensions, vault as $$
declare v_url text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'discord_webhook_url' limit 1;
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('embeds', jsonb_build_array(jsonb_build_object(
      'title', p_title, 'description', left(p_text, 1800), 'color', 15158332)))
  );
end $$;

-- 1) 도중에 죽은 실행: "실행 중"으로 15분(연속 실행 최대 시간) 넘게 남은 live 실행 → 한 번만 알림
create or replace function public.watchdog_stale_runs() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id, run_at from curation_logs
    where run_mode = 'live'
      and details->>'status' = 'running'
      and run_at < now() - interval '15 minutes'
      and coalesce(details->>'stale_alerted', '') = ''
  loop
    perform public.watchdog_discord('큐레이션 실행이 도중에 중단됨',
      '시작 시각 ' || to_char(r.run_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' (KST) 실행이 15분 넘게 끝나지 않았습니다. 서버가 자원 한도 등으로 죽었을 가능성이 큽니다. 큐레이션 보드 하단 로그에서 "중단됨"을 확인하세요.');
    update curation_logs set details = jsonb_set(details, '{stale_alerted}', '"1"') where id = r.id;
  end loop;
end $$;

-- 2) 크론이 안 뜬 경우: 예정일(auto_schedule.days, KST 요일)인데 오늘 끝난 live 실행이 없으면 알림
create or replace function public.watchdog_missed_run() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb; v_dow int; v_today_start timestamptz; v_done int;
begin
  select auto_schedule into s from curation_settings limit 1;
  if s is null or coalesce((s->>'enabled')::boolean, false) = false then return; end if;
  v_dow := extract(dow from (now() at time zone 'Asia/Seoul'))::int;
  if not (s->'days') @> to_jsonb(v_dow) then return; end if;
  v_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  select count(*) into v_done from curation_logs
    where run_mode = 'live' and run_at >= v_today_start
      and (coalesce(details->>'status', 'done') = 'done'
           or (details->>'status' = 'running' and run_at > now() - interval '15 minutes'));  -- 아직 정상적으로 도는 중인 실행은 누락이 아님(중단은 위 함수가 따로 알림)
  if v_done = 0 then
    perform public.watchdog_discord('큐레이션 자동 실행 누락',
      '오늘은 예정된 실행일인데 끝난 실행 기록이 없습니다. Vercel 크론이 안 뜬 것이거나 시작 직후 실패했을 수 있습니다. Vercel > Cron Jobs 로그와 큐레이션 보드 로그를 확인하세요.');
  end if;
end $$;

-- 스케줄 (UTC 기준): 중단 감지는 10분마다, 누락 감지는 매일 09:30 KST(= 00:30 UTC; 10:30 뉴스레터 발송 전에 알아채야 해서 일찍 확인)
select cron.unschedule(jobid) from cron.job where jobname in ('watchdog_stale_runs', 'watchdog_missed_run');
select cron.schedule('watchdog_stale_runs', '*/10 * * * *', $$select public.watchdog_stale_runs()$$);
select cron.schedule('watchdog_missed_run', '30 0 * * *', $$select public.watchdog_missed_run()$$);

-- ▼ 웹훅 등록 (한 번만, URL은 Vercel의 DISCORD_WEBHOOK_URL과 같은 값)
-- select vault.create_secret('여기에_디스코드_웹훅_URL', 'discord_webhook_url');
-- ▼ 동작 시험: select public.watchdog_discord('워치독 시험', '이 메시지가 보이면 정상입니다');
