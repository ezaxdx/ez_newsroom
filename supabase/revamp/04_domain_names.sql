-- ============================================================================
-- [4단계] 사업영역 이름 통일 — 기존 기사 8건의 변형 이름을 기준 이름으로 교체 (다른 컬럼·기사는 건드리지 않음)
--   ATT, ATT(All That Travel)                  → ATT(관광 전시)
--   MEeT, MEeT(Medical Emerging Technology)    → MEeT(의료 전시)
-- 실행: SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전(이미 통일된 기사는 대상이 아님).
-- 앞으로 저장되는 기사는 curate-v2 가 저장할 때 자동으로 기준 이름으로 통일합니다.
-- 이 SQL 은 02·03 과 무관하게 언제 실행해도 됩니다.
-- ============================================================================

update public.news n
set business_domains = (
  select coalesce(array_agg(distinct x order by x), '{}')
  from (
    select case
             when lower(replace(d, ' ', '')) like 'att%'  then 'ATT(관광 전시)'
             when lower(replace(d, ' ', '')) like 'meet%' then 'MEeT(의료 전시)'
             else d
           end as x
    from unnest(n.business_domains) as d
  ) t
)
where exists (
  select 1 from unnest(n.business_domains) as d
  where d not in ('스마트립', '글로컬 관광', 'AI 관광', 'MICE Tech', 'ATT(관광 전시)', 'MEeT(의료 전시)', 'AXDX')
);

-- 확인용: 기준 이름이 아닌 영역명이 남은 기사 수 (0 이어야 함)
select count(*) as remaining_variants
from public.news n
where exists (
  select 1 from unnest(n.business_domains) as d
  where d not in ('스마트립', '글로컬 관광', 'AI 관광', 'MICE Tech', 'ATT(관광 전시)', 'MEeT(의료 전시)', 'AXDX')
);
