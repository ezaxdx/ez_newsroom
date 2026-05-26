create table if not exists public.convention_events (
  id            uuid primary key default gen_random_uuid(),
  venue         text not null,
  venue_region  text,
  event_name    text not null,
  event_name_en text,
  start_date    date,
  end_date      date,
  location      text,
  category      text,
  industry      text,
  organizer     text,
  operator      text,
  website       text,
  is_published  boolean default true,
  created_at    timestamptz default now()
);

create index if not exists convention_events_start_date_idx on public.convention_events(start_date);
create index if not exists convention_events_venue_idx      on public.convention_events(venue);
create index if not exists convention_events_category_idx   on public.convention_events(category);

alter table public.convention_events enable row level security;

drop policy if exists "public read convention_events" on public.convention_events;
drop policy if exists "admin all convention_events"   on public.convention_events;

create policy "public read convention_events"
  on public.convention_events for select
  using (is_published = true);

create policy "admin all convention_events"
  on public.convention_events for all
  using (auth.role() = 'authenticated');
