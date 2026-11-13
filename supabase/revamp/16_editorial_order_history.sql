begin;
create table if not exists public.curation_order_history (
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
 window_end timestamptz not null, category text not null,
 automatic_order jsonb not null default '[]', before_order jsonb not null, after_order jsonb not null,
 reason text check(reason in ('business','timing','readers','balance','personal')), note text
);
alter table public.curation_order_history enable row level security;
revoke all on public.curation_order_history from anon,authenticated;
grant all on public.curation_order_history to service_role;
create index if not exists curation_order_history_recent on public.curation_order_history(created_at desc);
create table if not exists public.curation_save_receipts (
 request_id uuid primary key, payload_hash text not null, history_count integer not null,
 created_at timestamptz not null default now()
);
alter table public.curation_save_receipts enable row level security;
revoke all on public.curation_save_receipts from anon,authenticated;
grant all on public.curation_save_receipts to service_role;

-- Capture the saved change atomically. Dragging without saving produces no history.
create or replace function public.save_curation_items(p_items jsonb,p_reason text default null,p_note text default null,
 p_request_id uuid default null,p_deleted jsonb default '[]',p_republish jsonb default '[]')
returns integer language plpgsql security definer set search_path=public as $$
declare boundary timestamptz; category_name text; snapshots jsonb:='{}'; before_items jsonb; automatic_items jsonb; after_items jsonb; recorded integer:=0;
 save_token uuid:=coalesce(p_request_id,gen_random_uuid()); fingerprint text; receipt curation_save_receipts;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>500 then raise exception '저장 항목 형식 오류'; end if;
 if jsonb_typeof(p_deleted) is distinct from 'array' or jsonb_typeof(p_republish) is distinct from 'array'
  or jsonb_array_length(p_deleted)>500 or jsonb_array_length(p_republish)>500 then raise exception '저장 항목 형식 오류'; end if;
 if p_reason is not null and p_reason not in ('business','timing','readers','balance','personal') then raise exception '순서 변경 사유 오류'; end if;
 perform pg_advisory_xact_lock(7241026);
 fingerprint:=md5(jsonb_build_object('items',p_items,'reason',p_reason,'note',p_note,'deleted',p_deleted,'republish',p_republish)::text);
 select * into receipt from curation_save_receipts where request_id=save_token;
 if found then
  if receipt.payload_hash<>fingerprint then raise exception '저장 요청 내용이 변경되었습니다. 다시 저장해주세요.'; end if;
  return receipt.history_count;
 end if;
 select active_curation_window into boundary from curation_settings limit 1;
 boundary:=coalesce(boundary,now()-interval '7 days');
 for category_name in
  select distinct n.category from news n join jsonb_to_recordset(p_items) i(id uuid,display_order integer,is_published boolean,level text) on n.id=i.id
  where n.display_order is distinct from i.display_order and n.published_at>=boundary and (n.is_published or i.is_published)
 loop
  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.id),'[]') into before_items from
   (select id,title,left(summary_short,300) as summary,related_event_id,display_order,quality_criteria->'editorial' as automatic_recommendation
    from news where category=category_name and is_published=true and published_at>=boundary order by display_order,id limit 100) x;
  select coalesce(jsonb_agg(v order by
   case when v->'automatic_recommendation'->>'rank' ~ '^[0-9]+$' then (v->'automatic_recommendation'->>'rank')::integer end nulls last,v->>'id'),'[]')
   into automatic_items from jsonb_array_elements(before_items) v where v->'automatic_recommendation'->>'rank' ~ '^[0-9]+$';
  snapshots:=snapshots||jsonb_build_object(category_name,jsonb_build_object('before',before_items,'automatic',automatic_items));
 end loop;
 if exists(select 1 from jsonb_to_recordset(p_items) i(id uuid,is_published boolean,display_order integer,level text)
   where i.id is null or i.display_order is null or i.is_published is null or (i.level is not null and i.level not in ('Beginner','Intermediate','Advanced'))) then raise exception '기사 저장 값 오류'; end if;
 if (select count(distinct i.id) from jsonb_to_recordset(p_items) i(id uuid))<>jsonb_array_length(p_items)
  or exists(select 1 from jsonb_to_recordset(p_items) i(id uuid) where not exists(select 1 from news where id=i.id)) then raise exception '저장 대상이 변경되었습니다. 새로고침 후 다시 저장해주세요.'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_deleted) d where exists(select 1 from jsonb_to_recordset(p_items) i(id uuid) where i.id=d::uuid)
  or exists(select 1 from jsonb_array_elements_text(p_republish) r where r::uuid=d::uuid)) then raise exception '삭제와 발행 요청이 겹칩니다.'; end if;
 delete from news where id in (select value::uuid from jsonb_array_elements_text(p_deleted));
 update news set published_at=clock_timestamp() where id in (select value::uuid from jsonb_array_elements_text(p_republish));
 update news n set display_order=i.display_order,is_published=i.is_published,level=i.level,
   published_at=case when n.is_published=false and i.is_published=true then clock_timestamp() else n.published_at end
 from jsonb_to_recordset(p_items) i(id uuid,is_published boolean,display_order integer,level text) where n.id=i.id;
 for category_name in select jsonb_object_keys(snapshots) loop
  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.id),'[]') into after_items from
   (select id,title,left(summary_short,300) as summary,related_event_id,display_order,quality_criteria->'editorial' as automatic_recommendation
    from news where category=category_name and is_published=true and published_at>=boundary order by display_order,id limit 100)x;
  before_items:=snapshots->category_name->'before';
  if jsonb_path_query_array(before_items,'$[*].id') is distinct from jsonb_path_query_array(after_items,'$[*].id') then
   insert into curation_order_history(window_end,category,automatic_order,before_order,after_order,reason,note)
    values(boundary,category_name,snapshots->category_name->'automatic',before_items,after_items,p_reason,left(p_note,500));
   recorded:=recorded+1;
  end if;
 end loop;
 insert into curation_save_receipts(request_id,payload_hash,history_count) values(save_token,fingerprint,recorded);
 return recorded;
end $$;
revoke all on function public.save_curation_items(jsonb,text,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_curation_items(jsonb,text,text,uuid,jsonb,jsonb) to service_role;
commit;
