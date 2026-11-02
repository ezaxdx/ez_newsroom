-- Temporary administrator recovery control. Does not delete or rewrite articles.
begin;
alter table public.curation_settings add column if not exists temporary_archive_control jsonb not null default '{"enabled":true}';
create or replace function public.manual_archive_curation(p_action text default 'preview', p_cutoff timestamptz default null,
  p_boundary timestamptz default null, p_count integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s curation_settings; cutoff timestamptz; candidate timestamptz; total integer; kept integer; day_offset integer; hour_kst integer;
begin
  perform pg_advisory_xact_lock(7241026);
  select * into strict s from curation_settings for update;
  if coalesce((s.temporary_archive_control->>'enabled')::boolean,true)=false then
    raise exception '임시 아카이빙 기능이 종료됐습니다';
  end if;
  if p_action='disable' then
    update curation_settings set temporary_archive_control=temporary_archive_control||jsonb_build_object('enabled',false) where id=s.id;
    return jsonb_build_object('disabled',true);
  end if;
  if p_action not in ('preview','archive') then raise exception '지원하지 않는 요청입니다'; end if;
  if exists(select 1 from curation_batches where lease_until>now()) then raise exception '큐레이션 실행 중입니다. 완료 또는 중단 후 다시 확인해 주세요'; end if;
  if s.active_curation_window is null then raise exception '현재 회차 기준이 없습니다. 관리자 확인이 필요합니다'; end if;
  hour_kst:=coalesce((s.auto_schedule->>'hour')::integer,9);
  if hour_kst<0 or hour_kst>23 then raise exception '예약 시각 설정을 확인해 주세요'; end if;
  for day_offset in 0..7 loop
    candidate:=(date_trunc('day',now() at time zone 'Asia/Seoul')-make_interval(days=>day_offset)+make_interval(hours=>hour_kst)) at time zone 'Asia/Seoul';
    if candidate<=now() and (s.auto_schedule->'days') @> to_jsonb(extract(dow from candidate at time zone 'Asia/Seoul')::integer) then
      cutoff:=candidate; exit;
    end if;
  end loop;
  if cutoff is null then raise exception '예약 요일 설정을 확인해 주세요'; end if;
  select count(*) into total from news where is_published=true and published_at>=s.active_curation_window and published_at<cutoff;
  select count(*) into kept from news where is_published=true and published_at>=greatest(cutoff,s.active_curation_window);
  if p_action='archive' then
    if p_cutoff is distinct from cutoff or p_boundary is distinct from s.active_curation_window or p_count is distinct from total then
      raise exception '회차 또는 기사 수가 변경됐습니다. 대상을 다시 확인해 주세요';
    end if;
    if cutoff<=s.active_curation_window or total=0 then raise exception '넘길 이전 회차 기사가 없습니다'; end if;
    update curation_settings set active_curation_window=cutoff,
      temporary_archive_control=temporary_archive_control||jsonb_build_object('last_action',
        jsonb_build_object('at',now(),'previous_boundary',s.active_curation_window,'cutoff',cutoff,'count',total))
      where id=s.id;
  end if;
  return jsonb_build_object('cutoff',cutoff,'boundary',s.active_curation_window,'count',total,'kept',kept,
    'available',cutoff>s.active_curation_window and total>0,'archived',p_action='archive');
end $$;
revoke all on function public.manual_archive_curation(text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.manual_archive_curation(text,timestamptz,timestamptz,integer) to service_role;
commit;
