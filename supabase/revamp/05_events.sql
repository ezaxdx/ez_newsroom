-- 05_events.sql — 행사 수집 개편 (AKEI 자동 수집 + 분야 기준 자동 비공개)
-- 실행: Supabase SQL Editor. 컬럼 추가·시드뿐이라 기존 동작에 영향 없음.

-- 1) 수집 이력에 AKEI 건수·자동 제외 내역 추가
alter table public.scrape_logs
  add column if not exists source        text,        -- akei|keoa|showala (소스별로 따로 실행·기록)
  add column if not exists akei_scraped  integer,
  add column if not exists dropped_count integer,
  add column if not exists dropped       jsonb,      -- 필터로 제외된 행사 샘플 [{name,date,reason}] (오탐 확인용)
  add column if not exists source_errors jsonb;      -- 소스별 실패 메시지 {akei:"...", keoa:"..."}

-- 1-b) 관리자가 직접 공개/비공개를 바꾼 행사는 잠금 — 수집·규칙 소급 적용이 덮어쓰지 않음
alter table public.convention_events
  add column if not exists publish_locked boolean not null default false;

-- 2) 비공개 규칙에 'category'(전시분야) 유형 추가 — 기존 name/industry 와 같은 테이블 사용
--    (filter_type 에 CHECK 제약이 없어 값만 새로 쓰면 됨)
-- 지금까지 관리자가 비공개로 돌려온 분야 중 사실상 전량 비공개인 것만 시드
--   임신/출산/육아: 비공개 87 / 공개 1, 웨딩: 비공개 2 / 공개 0, 교육: 비공개 11 / 공개 1
insert into public.event_keyword_filters (keyword, filter_type, memo) values
  ('임신/출산/육아', 'category', '기존 비공개 이력 기반 시드 (2026-10)'),
  ('웨딩',           'category', '기존 비공개 이력 기반 시드 (2026-10)'),
  ('교육',           'category', '기존 비공개 이력 기반 시드 (2026-10)')
on conflict (keyword, filter_type) do nothing;
