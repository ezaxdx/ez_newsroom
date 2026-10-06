-- 08_event_scoring.sql — 행사 점수 산식 개편 (주최사 가산 목록 · 수행실적 발주처 · 설정)
-- 실행: Supabase SQL Editor. 새 테이블 2개 + 초기 주최사 목록 시드. 기존 동작에는 영향 없음
-- (이 SQL 을 실행하기 전에는 점수 계산이 주최사 목록 없이 코드 기본값만으로 동작함).

-- 1) 주최사 가산 목록 — 행사 점수에서 주최·주관 기관을 보고 가산하는 근거
--    tier: client(수행실적 발주처·주최·주관, 엑셀로 자동 갱신) | peer(동종 업계) | venue(장소 운영사) | peo(PEO 계열, 후순위)
create table if not exists public.event_org_affinity (
  id          uuid primary key default gen_random_uuid(),
  org_key     text not null,                 -- 정규화한 기관명 (소문자, (주)·공백 제거)
  org_name    text not null,                 -- 화면에 보이는 이름
  tier        text not null,                 -- client | peer | venue | peo
  source      text not null default 'manual',-- manual | track_record
  hit_count   integer not null default 0,    -- client: 수행실적에서 등장한 횟수 (최근 연도 가중)
  last_year   integer,                       -- client: 가장 최근 수행 연도
  created_at  timestamptz not null default now(),
  unique (org_key, tier)
);
create index if not exists event_org_affinity_tier_idx on public.event_org_affinity (tier);

-- 2) 점수 설정 (한 행) — 수행실적 기준일, 가중치 덮어쓰기
create table if not exists public.event_scoring_settings (
  id                 integer primary key default 1 check (id = 1),
  track_record_at    timestamptz,            -- 수행실적 엑셀을 마지막으로 반영한 시각
  track_record_file  text,                   -- 반영한 파일명
  track_record_rows  integer,                -- 행사형 수행실적 건수
  weights            jsonb not null default '{}'::jsonb,  -- 비어 있으면 코드 기본값 (public, client, peer, venue, peo, kw_cap ...)
  updated_at         timestamptz not null default now()
);
insert into public.event_scoring_settings (id) values (1) on conflict (id) do nothing;

alter table public.event_org_affinity     enable row level security;
alter table public.event_scoring_settings enable row level security;
drop policy if exists "admin all event_org_affinity"     on public.event_org_affinity;
drop policy if exists "admin all event_scoring_settings" on public.event_scoring_settings;
create policy "admin all event_org_affinity"     on public.event_org_affinity     for all using (auth.role() = 'authenticated');
create policy "admin all event_scoring_settings" on public.event_scoring_settings for all using (auth.role() = 'authenticated');

-- 3) 초기 주최사 목록 (설정 화면에서 추가·삭제 가능)
insert into public.event_org_affinity (org_key, org_name, tier) values
  -- 동종 업계 (1순위)
  ('메쎄이상',     '메쎄이상',     'peer'),
  ('서울메쎄',     '서울메쎄',     'peer'),
  ('메세코리아',   '메세코리아',   'peer'),
  ('인터컴',       '인터컴',       'peer'),
  ('이오컨벡스',   '이오컨벡스',   'peer'),
  ('인세션',       '인세션',       'peer'),
  ('한국mice협회', '한국MICE협회', 'peer'),
  ('엑스포럼',     '엑스포럼',     'peer'),
  -- 장소 운영사 (주최 행사)
  ('코엑스',           '코엑스',           'venue'),
  ('킨텍스',           '킨텍스',           'venue'),
  ('벡스코',           '벡스코',           'venue'),
  ('엑스코',           '엑스코',           'venue'),
  ('세텍',             '세텍',             'venue'),
  ('at센터',           'aT센터',           'venue'),
  ('송도컨벤시아',     '송도컨벤시아',     'venue'),
  ('수원컨벤션센터',   '수원컨벤션센터',   'venue'),
  ('김대중컨벤션센터', '김대중컨벤션센터', 'venue'),
  ('창원컨벤션센터',   '창원컨벤션센터',   'venue'),
  ('대전컨벤션센터',   '대전컨벤션센터',   'venue'),
  ('제주국제컨벤션센터','제주국제컨벤션센터','venue'),
  ('경주화백컨벤션센터','경주화백컨벤션센터','venue'),
  -- PEO 계열 (후순위)
  ('동아전람',     '동아전람',     'peo'),
  ('미래전람',     '미래전람',     'peo'),
  ('경연전람',     '경연전람',     'peo'),
  ('한국국제전시', '한국국제전시', 'peo'),
  ('한국이앤엑스', '한국이앤엑스', 'peo'),
  ('인포더',       '인포더',       'peo'),
  ('제일좋은전람', '제일좋은전람', 'peo'),
  ('메가쇼',       '메가쇼',       'peo'),
  ('코아미',       '코아미',       'peo')
on conflict (org_key, tier) do nothing;
