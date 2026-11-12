-- Keep total attempts for audit; collection and processing each get a bounded budget.
begin;
do $$ begin
 perform pg_advisory_xact_lock(7241026);
 if exists(select 1 from curation_batches where lease_until>now()) then raise exception '큐레이션 실행이 끝난 뒤 적용해주세요.'; end if;
end $$;
alter table public.curation_batches add column if not exists collection_attempts integer not null default 0;
alter table public.curation_batches add column if not exists processing_attempts integer not null default 0;
-- Existing batches retain consumed attempts. Completed/expired batches are never replayed.
with used as (
 select b.id,b.attempts,case when b.snapshot->>'phase'='selected' then least(b.attempts,
  (select count(*)::integer from curation_logs l where l.details->>'batch_id'=b.id::text and l.details->>'phase'='collecting')) else b.attempts end as collecting
 from curation_batches b where b.attempts>0 and b.collection_attempts=0 and b.processing_attempts=0
)
update curation_batches b set collection_attempts=u.collecting,processing_attempts=u.attempts-u.collecting from used u where b.id=u.id;
create or replace function public.claim_curation_batch(p_start timestamptz, p_end timestamptz, p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b curation_batches; processing boolean; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  perform pg_advisory_xact_lock(7241026);
  if exists(select 1 from curation_batches where lease_until > now()) then
    return jsonb_build_object('skipped',true,'message','이미 큐레이션이 실행 중입니다.');
  end if;
  update curation_work w set state='expired', last_error='수집 창 종료'
    from curation_batches expired_batch where w.batch_id=expired_batch.id and expired_batch.expires_at<=now()
    and w.state in ('pending','retry','publish','stage');
  update curation_batches set status='expired', lease=null, lease_until=null
    where expires_at<=now() and status not in ('done','expired');
  update curation_logs l set details=l.details || jsonb_build_object('status','expired',
    'queue',coalesce(l.details->'queue','{}'::jsonb) || jsonb_build_object('pending',0,'retry',0,'prepared',0,
      'expired',(select count(*) from curation_work where batch_id=expired_batch.id and state='expired')))
    from curation_batches expired_batch where expired_batch.status='expired' and l.id=(select id from curation_logs
      where details->>'batch_id'=expired_batch.id::text order by run_at desc limit 1);
  insert into curation_batches(window_start,window_end,expires_at) values(p_start,p_end,p_expires)
    on conflict(window_end) do nothing;
  select * into b from curation_batches where window_end=p_end for update;
  if b.status in ('done','expired') then
    return jsonb_build_object('skipped',true,'message','이미 완료되었거나 종료된 수집 창입니다.');
  end if;
  if b.retry_blocked_reason is not null then
    return jsonb_build_object('skipped',true,'message','원인 수정 후 재개가 필요한 회차입니다: '||b.retry_blocked_reason);
  end if;
  processing:=coalesce(b.snapshot->>'phase','collecting')='selected';
  if (case when processing then b.processing_attempts else b.collection_attempts end)>=8 then
    return jsonb_build_object('skipped',true,'limit_reached',true,'batch_id',b.id,'message',case when processing then '기사 처리' else '목록 수집' end||' 단계의 실행 상한(8회)에 도달했습니다. 저장된 작업과 오류를 확인한 뒤 관리자 재개가 필요합니다.');
  end if;
  update curation_batches set status='running', lease=gen_random_uuid(), lease_until=now()+interval '10 minutes',
    attempts=attempts+1, collection_attempts=collection_attempts+case when processing then 0 else 1 end,
    processing_attempts=processing_attempts+case when processing then 1 else 0 end, attempt_day=today
    where id=b.id returning * into b;
  return to_jsonb(b);
end $$;


create or replace function public.resume_curation_batches()
returns void language plpgsql security definer set search_path = public as $$
declare b curation_batches; endpoint text; secret text; request_id bigint; reply record;
begin
  perform pg_advisory_xact_lock(7241026);
  if exists(select 1 from curation_batches where lease_until>now()) then return; end if;
  select * into b from curation_batches where status in ('pending','running','partial') and expires_at>now() and (case when snapshot->>'phase'='selected' then processing_attempts else collection_attempts end)<8 and retry_blocked_reason is null
    and (last_dispatch_at is null or last_dispatch_at<now()-interval '10 minutes') order by window_end desc limit 1;
  if b.id is null then return; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='curation_function_url' limit 1;
  select decrypted_secret into secret from vault.decrypted_secrets where name='curation_cron_secret' limit 1;
  if endpoint is null or secret is null then
    update curation_batches set dispatch_error='자동 복구용 Vault 설정 누락',last_dispatch_at=now() where id=b.id;
    update curation_logs set details=details || jsonb_build_object('continuation',jsonb_build_object('status','failed','error','자동 복구용 Vault 설정 누락'))
      where id=(select id from curation_logs where details->>'batch_id'=b.id::text order by run_at desc limit 1);
    return;
  end if;
  select status_code,error_msg into reply from net._http_response where id=b.dispatch_request_id;
  if found and (reply.status_code is distinct from 202 or reply.error_msg is not null) then
    update curation_logs set details=details || jsonb_build_object('continuation',jsonb_build_object('status','failed',
      'error',coalesce(reply.error_msg,'자동 복구 요청 HTTP '||coalesce(reply.status_code::text,'응답 없음'))))
      where id=(select id from curation_logs where details->>'batch_id'=b.id::text order by run_at desc limit 1);
  end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret',secret),
    body:=jsonb_build_object('live',true,'trigger','recovery','window_end',extract(epoch from b.window_end)*1000),timeout_milliseconds:=15000)
    into request_id;
  update curation_batches set last_dispatch_at=now(),dispatch_error=null,dispatch_request_id=request_id where id=b.id;
exception when others then
  update curation_batches set dispatch_error=sqlerrm,last_dispatch_at=now() where id=b.id;
end $$;


-- Extend the existing source configuration, preserving other fetch options.
update rss_sources set fetch_config=coalesce(fetch_config,'{}'::jsonb)||jsonb_build_object('engines',jsonb_build_array('naver','google'))
where source_type='keyword_search' and source_name='MICE Tech' and url='MICE Tech';
commit;
