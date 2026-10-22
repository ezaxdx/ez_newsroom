-- 관리자 적합성 판정 사례 (2026-10-20)
-- 큐레이션 보드의 "좋은 기사"·"부적합" 표시와 직접 작성 기사를 [{title, fit, note, kind, at}]로 쌓아
-- curate-v2 적합성 판정(judgeFit)의 예시로 주입. kind: good(좋은 기사) | bad(부적합) | manual(직접 작성)
-- 실행: Supabase SQL Editor에서 이 파일 전체 실행 (컬럼 추가만 — 기존 데이터·동작에 영향 없음)

alter table public.curation_settings
  add column if not exists fit_examples jsonb default '[]';

-- 확인: 1행이 나오면 정상
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'curation_settings' and column_name = 'fit_examples';
