-- Apply after 12_curation_queue.sql, before deploying the worker and web app.
-- Existing expired batches and manual publications are not replayed or rewritten.
begin;
alter table public.curation_batches add column if not exists retry_blocked_reason text;

create or replace function public.claim_curation_batch(p_start timestamptz, p_end timestamptz, p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b curation_batches; today date := (now() at time zone 'Asia/Seoul')::date;
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
  if b.attempts>=8 then
    return jsonb_build_object('skipped',true,'message','이 회차의 실행 상한(8회)에 도달했습니다.');
  end if;
  update curation_batches set status='running', lease=gen_random_uuid(), lease_until=now()+interval '10 minutes',
    attempts=attempts+1, attempt_day=today
    where id=b.id returning * into b;
  return to_jsonb(b);
end $$;

create or replace function public.finish_curation_batch(p_batch uuid, p_lease uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare settings_row curation_settings; b curation_batches; w curation_work; n news; new_id uuid; pub int:=0; staged int:=0; cutoff timestamptz:=clock_timestamp();
begin
  select * into b from curation_batches where id=p_batch for update;
  if b.lease is distinct from p_lease or b.lease_until<=now() or b.expires_at<=now() then raise exception '큐레이션 잠금 또는 수집 창 만료'; end if;
  if exists(select 1 from curation_work where batch_id=p_batch and state in ('pending','retry')) then
    update curation_batches set status='partial' where id=p_batch;
    return jsonb_build_object('status','partial','published',0,'staged',0);
  end if;
  for w in select * from curation_work where batch_id=p_batch and state in ('publish','stage') order by position loop
    n := jsonb_populate_record(null::news,w.article);
    new_id:=null;
    insert into news(title,summary_short,content_long,implications,level,image_url,original_url,category,quality_score,quality_criteria,
      business_domains,is_published,priority_score,display_order,published_at,original_title,found_via,coverage_count,
      related_event_id,category_reason,category_edited,fit_reason,curation_url_key)
    values(n.title,n.summary_short,n.content_long,n.implications,n.level,n.image_url,n.original_url,n.category,n.quality_score,n.quality_criteria,
      n.business_domains,w.state='publish',n.priority_score,n.display_order,case when w.state='publish' then cutoff else n.published_at end,
      n.original_title,n.found_via,n.coverage_count,(select id from convention_events where id=n.related_event_id),n.category_reason,n.category_edited,n.fit_reason,w.url_key)
    on conflict do nothing returning id into new_id;
    if new_id is null then
      update curation_work set state='excluded',last_error='이미 저장된 기사 URL' where batch_id=p_batch and url_key=w.url_key;
    else
      insert into news_original_text(news_id,original_text) values(new_id,w.payload->>'text') on conflict do nothing;
      update curation_work set state=case when w.state='publish' then 'published' else 'staged' end where batch_id=p_batch and url_key=w.url_key;
      if w.state='publish' then pub:=pub+1; else staged:=staged+1; end if;
    end if;
  end loop;
  if pub>0 then
    select * into strict settings_row from curation_settings for update;
    -- Preserve manual articles from this edition; never move a newer boundary backwards.
    update curation_settings set active_curation_window=greatest(active_curation_window,b.window_end)
      where id=settings_row.id;
  end if;
  update curation_batches set status='done' where id=p_batch;
  return jsonb_build_object('status','done','published',pub,'staged',staged);
end $$;

create or replace function public.resume_curation_batches()
returns void language plpgsql security definer set search_path = public as $$
declare b curation_batches; endpoint text; secret text; request_id bigint; reply record;
begin
  perform pg_advisory_xact_lock(7241026);
  if exists(select 1 from curation_batches where lease_until>now()) then return; end if;
  select * into b from curation_batches where status in ('pending','running','partial') and expires_at>now() and attempts<8 and retry_blocked_reason is null
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

create table if not exists public.curation_notifications (
  notification_key text primary key,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.curation_notifications enable row level security;
revoke all on public.curation_notifications from anon,authenticated;
grant all on public.curation_notifications to service_role;

-- Concurrent watchers share a claim. Failed deliveries can retry; sent alerts cannot.
create or replace function public.claim_curation_notification(p_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare token uuid;
begin
  insert into curation_notifications(notification_key) values(p_key)
  on conflict(notification_key) do update set claim_token=gen_random_uuid(),claimed_at=now()
    where curation_notifications.sent_at is null and curation_notifications.claimed_at<now()-interval '10 minutes'
  returning claim_token into token;
  return token;
end $$;
revoke all on function public.claim_curation_notification(text) from public,anon,authenticated;
grant execute on function public.claim_curation_notification(text) to service_role;

commit;
