begin;
create table if not exists public.newsletter_schedules (
 id uuid primary key default gen_random_uuid(), issue_id uuid not null unique references newsletter_issues(id),
 scheduled_at timestamptz not null, subject text not null,
 status text not null default 'scheduled' check(status in ('scheduled','running','completed','cancelled','attention')),
 recipients jsonb not null, cursor integer not null default 0, cancel_requested boolean not null default false,
 lease uuid, lease_until timestamptz, error text, created_at timestamptz not null default now()
);
alter table public.newsletter_schedules enable row level security;
revoke all on public.newsletter_schedules from anon, authenticated;
grant all on public.newsletter_schedules to service_role;
-- Serialize manual send starts against reservation creation, including requests already in flight.
create or replace function public.guard_newsletter_send_start()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='sending' then
  perform pg_advisory_xact_lock(7111030);
  if exists(select 1 from newsletter_schedules where status in ('scheduled','running','attention'))
   and current_setting('app.newsletter_worker_issue',true) is distinct from new.id::text then
   raise exception '예약 발송을 취소·중지한 뒤 수동 발송해주세요.';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists newsletter_send_start_guard on public.newsletter_issues;
create trigger newsletter_send_start_guard before insert or update of status on public.newsletter_issues
for each row execute function public.guard_newsletter_send_start();
create or replace function public.schedule_newsletter(p_at timestamptz,p_vol integer,p_subject text,p_html text,p_editorial text,p_featured jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare issue uuid; job uuid; targets jsonb;
begin
 perform pg_advisory_xact_lock(7111030);
 if p_at<now()+interval '1 minute' or p_at>now()+interval '30 days' then raise exception '예약 시각은 1분 후부터 30일 이내로 지정해주세요.'; end if;
 if exists(select 1 from newsletter_issues where status='sending') then raise exception '현재 발송 중인 뉴스레터가 있습니다.'; end if;
 if exists(select 1 from newsletter_schedules where status in ('scheduled','running','attention')) then raise exception '진행 중인 예약을 먼저 확인해주세요.'; end if;
 -- A never-started cancellation can be replaced with a new snapshot of the same issue.
 delete from newsletter_schedules where status='cancelled' and issue_id in (select id from newsletter_issues where vol_number=p_vol and sent_at is null and total_sent=0);
 delete from newsletter_issues where vol_number=p_vol and status='cancelled' and sent_at is null and total_sent=0 and not exists(select 1 from newsletter_send_logs l where l.issue_id=newsletter_issues.id);
 if exists(select 1 from newsletter_issues where vol_number=p_vol) then raise exception '이미 사용된 Vol입니다. 미리보기를 다시 만들어주세요.'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'email',email) order by id) into targets from newsletter_subscribers where is_active=true;
 if targets is null then raise exception '활성 수신자가 없습니다.'; end if;
 insert into newsletter_issues(vol_number,editorial_text,status,html_content,target_count,total_sent,total_failed,featured_event_ids)
 values(p_vol,p_editorial,'scheduled',p_html,jsonb_array_length(targets),0,0,p_featured) returning id into issue;
 insert into newsletter_schedules(issue_id,scheduled_at,subject,recipients) values(issue,p_at,p_subject,targets) returning id into job;
 return job;
end $$;
create or replace function public.claim_newsletter_schedule()
returns jsonb language plpgsql security definer set search_path=public as $$
declare job newsletter_schedules;
begin
 perform pg_advisory_xact_lock(7111030);
 update newsletter_schedules set status='attention',error='발송 작업 응답이 끊겼습니다. 성공 로그와 Gmail 보낸메일을 확인해주세요.' where status='running' and lease_until<now();
 select * into job from newsletter_schedules where status='scheduled' and scheduled_at<=now() order by scheduled_at for update skip locked limit 1;
 if job.id is null then return null; end if;
 update newsletter_schedules set status='running',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=job.id returning * into job;
 perform set_config('app.newsletter_worker_issue',job.issue_id::text,true);
 update newsletter_issues set status='sending',sent_at=coalesce(sent_at,now()) where id=job.issue_id;
 return to_jsonb(job);
end $$;
create or replace function public.cancel_newsletter_schedule(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare job newsletter_schedules;
begin
 select * into job from newsletter_schedules where id=p_id for update;
 if not found then raise exception '예약 없음'; end if;
 if job.status='completed' then raise exception '이미 완료된 발송입니다.'; end if;
 update newsletter_schedules set cancel_requested=true,status=case when status='running' then 'running' else 'cancelled' end where id=p_id;
 if job.status<>'running' then update newsletter_issues set status=case when total_sent>0 then 'partial' else 'cancelled' end where id=job.issue_id; end if;
end $$;
revoke all on function public.schedule_newsletter(timestamptz,integer,text,text,text,jsonb),public.claim_newsletter_schedule(),public.cancel_newsletter_schedule(uuid) from public,anon,authenticated;
grant execute on function public.schedule_newsletter(timestamptz,integer,text,text,text,jsonb),public.claim_newsletter_schedule(),public.cancel_newsletter_schedule(uuid) to service_role;
create or replace function public.finish_newsletter_schedule(p_id uuid,p_lease uuid,p_cursor integer,p_sent integer,p_failed integer)
returns text language plpgsql security definer set search_path=public as $$
declare job newsletter_schedules; next_status text;
begin
 perform pg_advisory_xact_lock(7111030);
 select * into job from newsletter_schedules where id=p_id for update;
 if job.status<>'running' or job.lease is distinct from p_lease or job.lease_until<now() then raise exception '발송 작업 잠금 만료'; end if;
 if p_cursor<job.cursor or p_cursor>jsonb_array_length(job.recipients) then raise exception '발송 진행 위치 오류'; end if;
 next_status:=case when job.cancel_requested then 'cancelled' when p_cursor>=jsonb_array_length(job.recipients) then 'completed' else 'scheduled' end;
 perform set_config('app.newsletter_worker_issue',job.issue_id::text,true);
 update newsletter_issues set status=case when next_status='cancelled' then case when p_sent>0 then 'partial' else 'cancelled' end when next_status='completed' then case when p_failed>0 then 'partial' else 'sent' end else 'sending' end,total_sent=p_sent,total_failed=p_failed where id=job.issue_id;
 update newsletter_schedules set cursor=p_cursor,status=next_status,lease=null,lease_until=null where id=p_id;
 return next_status;
end $$;
revoke all on function public.finish_newsletter_schedule(uuid,uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.finish_newsletter_schedule(uuid,uuid,integer,integer,integer) to service_role;
-- Dedicated worker credentials are configured in Vault at deployment.
create or replace function public.authorize_newsletter_worker(p_secret text)
returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from vault.decrypted_secrets where name='newsletter_worker_secret' and decrypted_secret=p_secret and length(p_secret)>=32);
$$;
revoke all on function public.authorize_newsletter_worker(text) from public,anon,authenticated;
grant execute on function public.authorize_newsletter_worker(text) to service_role;
create or replace function public.dispatch_newsletter_schedule()
returns void language plpgsql security definer set search_path=public as $$
declare endpoint text; secret text;
begin
 if not exists(select 1 from newsletter_schedules where (status='scheduled' and scheduled_at<=now()) or (status='running' and lease_until<now())) then return; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='newsletter_worker_url' limit 1;
 select decrypted_secret into secret from vault.decrypted_secrets where name='newsletter_worker_secret' limit 1;
 if endpoint is null or secret is null then raise exception '예약 발송 서버 설정 누락'; end if;
 perform net.http_get(url:=endpoint,headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=60000);
end $$;
revoke all on function public.dispatch_newsletter_schedule() from public,anon,authenticated;
grant execute on function public.dispatch_newsletter_schedule() to service_role;
select cron.schedule('newsletter_scheduled_send','* * * * *','select public.dispatch_newsletter_schedule()');
commit;
