-- ============================================================================
-- [3단계] 레벨 사례 누적 · 적합성 판정 근거 저장 — 컬럼 2개 추가 (기존 데이터 변경 없음)
-- 실행: SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
-- ⚠ 02_cutover.sql 보다 "먼저" 실행하세요. (전환 후 curate-v2 가 news.fit_reason 에 저장하기 때문)
--    이 SQL 만 실행하는 것은 기존 동작에 영향이 없습니다.
-- ============================================================================

alter table public.curation_settings
  add column if not exists level_examples jsonb default '[]';   -- 관리자가 직접 고친 레벨 사례 [{title, level}] — 큐레이션 프롬프트에 few-shot 으로 주입

alter table public.news
  add column if not exists fit_reason text;                     -- AI 적합성 판정 근거 한 줄 (대기열 검토 때 표시)

-- 확인용: 컬럼이 2개 보여야 함
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'curation_settings' and column_name = 'level_examples') or (table_name = 'news' and column_name = 'fit_reason'))
order by table_name;
