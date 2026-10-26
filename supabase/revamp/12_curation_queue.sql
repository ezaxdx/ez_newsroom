-- Apply before deploying curate-v2. Additive; existing articles are not rewritten.
begin;
alter table public.curation_settings add column if not exists active_curation_window timestamptz;
alter table public.news add column if not exists curation_url_key text;
create unique index if not exists news_curation_url_key_unique on public.news(curation_url_key);

create table if not exists public.curation_batches (
  id uuid primary key default gen_random_uuid(),
  window_start timestamptz not null,
  window_end timestamptz not null unique,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','running','partial','done','expired')),
  snapshot jsonb,
  lease uuid,
  lease_until timestamptz,
  attempt_day date,
  attempts integer not null default 0,
  last_dispatch_at timestamptz,
  dispatch_error text,
  dispatch_request_id bigint,
  created_at timestamptz not null default now()
);
create table if not exists public.curation_work (
  batch_id uuid not null references public.curation_batches(id),
  url_key text not null,
  position integer not null,
  state text not null default 'pending' check (state in ('pending','retry','publish','stage','published','staged','excluded','failed','expired')),
  attempts integer not null default 0,
  payload jsonb not null,
  judgement jsonb,
  article jsonb,
  last_error text,
  primary key (batch_id, url_key)
);
alter table public.curation_batches enable row level security;
alter table public.curation_work enable row level security;
revoke all on public.curation_batches, public.curation_work from anon, authenticated;
grant all on public.curation_batches, public.curation_work to service_role;

-- One live worker at a time, including overlapping manual/cron requests.
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
  if coalesce((select sum(attempts) from curation_batches where attempt_day=today),0)>=8 then
    return jsonb_build_object('skipped',true,'message','하루 실행 상한(8회)에 도달했습니다.');
  end if;
  insert into curation_batches(window_start,window_end,expires_at) values(p_start,p_end,p_expires)
    on conflict(window_end) do nothing;
  select * into b from curation_batches where window_end=p_end for update;
  if b.status in ('done','expired') then
    return jsonb_build_object('skipped',true,'message','이미 완료되었거나 종료된 수집 창입니다.');
  end if;
  update curation_batches set status='running', lease=gen_random_uuid(), lease_until=now()+interval '10 minutes',
    attempts=case when attempt_day=today then attempts+1 else 1 end, attempt_day=today
    where id=b.id returning * into b;
  return to_jsonb(b);
end $$;

-- Checkpoint writes are fenced by the worker lease. A stale worker cannot overwrite a retry.
create or replace function public.save_curation_work(p_batch uuid, p_lease uuid, p_rows jsonb, p_snapshot jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare b curation_batches; r jsonb;
begin
  select * into b from curation_batches where id=p_batch for update;
  if b.lease is distinct from p_lease or b.lease_until<=now() or b.expires_at<=now() then
    raise exception '큐레이션 작업 잠금 또는 수집 창 만료';
  end if;
  if p_snapshot is not null then update curation_batches set snapshot=p_snapshot where id=p_batch; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into curation_work(batch_id,url_key,position,state,attempts,payload,judgement,article,last_error)
    values(p_batch,r->>'url_key',(r->>'position')::int,coalesce(r->>'state','pending'),coalesce((r->>'attempts')::int,0),r->'payload',r->'judgement',r->'article',r->>'last_error')
    on conflict(batch_id,url_key) do update set state=excluded.state, attempts=excluded.attempts,
      payload=excluded.payload, judgement=excluded.judgement, article=excluded.article, last_error=excluded.last_error;
  end loop;
end $$;

-- Publish the prepared batch and switch the live/archive boundary in one transaction.
create or replace function public.finish_curation_batch(p_batch uuid, p_lease uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b curation_batches; w curation_work; n news; new_id uuid; pub int:=0; staged int:=0; cutoff timestamptz:=clock_timestamp();
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
  if pub>0 then update curation_settings set active_curation_window=cutoff; end if;
  update curation_batches set status='done' where id=p_batch;
  return jsonb_build_object('status','done','published',pub,'staged',staged);
end $$;

revoke all on function public.claim_curation_batch(timestamptz,timestamptz,timestamptz), public.save_curation_work(uuid,uuid,jsonb,jsonb), public.finish_curation_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_curation_batch(timestamptz,timestamptz,timestamptz), public.save_curation_work(uuid,uuid,jsonb,jsonb), public.finish_curation_batch(uuid,uuid) to service_role;

-- Recovery is independent of the worker: also resumes after a hard runtime stop.
-- Use existing pg_cron/pg_net + Vault (same infrastructure as 10_watchdog.sql).
-- Before enabling production recovery, set Vault secrets curation_function_url
-- (https://<project>.supabase.co/functions/v1/curate-v2) and curation_cron_secret.
-- No keys or webhook URLs belong in this file.
create or replace function public.resume_curation_batches()
returns void language plpgsql security definer set search_path = public as $$
declare b curation_batches; endpoint text; secret text; request_id bigint; reply record;
begin
  perform pg_advisory_xact_lock(7241026);
  if exists(select 1 from curation_batches where lease_until>now()) then return; end if;
  select * into b from curation_batches where status in ('pending','running','partial') and expires_at>now()
    and (last_dispatch_at is null or last_dispatch_at<now()-interval '10 minutes') order by window_end desc limit 1;
  if b.id is null then return; end if;
  if coalesce((select sum(attempts) from curation_batches where attempt_day=(now() at time zone 'Asia/Seoul')::date),0)>=8 then return; end if;
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
revoke all on function public.resume_curation_batches() from public,anon,authenticated;
grant execute on function public.resume_curation_batches() to service_role;
do $$ begin
  if to_regnamespace('cron') is not null and to_regnamespace('net') is not null and to_regnamespace('vault') is not null then
    perform cron.schedule('curation_queue_recovery','*/5 * * * *','select public.resume_curation_batches()');
  end if;
end $$;

-- Seed the existing live edition once; failed/empty updates will retain this boundary.
update curation_settings set active_curation_window=coalesce(
  (select (details->'window'->>'end')::timestamptz from curation_logs where run_mode='live' and published>0
    and details->'window'->>'end' is not null order by run_at desc limit 1),
  (select max(published_at)-interval '7 days' from news where is_published=true),now()-interval '7 days')
where active_curation_window is null;
commit;
