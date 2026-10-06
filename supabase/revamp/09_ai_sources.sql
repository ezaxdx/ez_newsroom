-- 09_ai_sources.sql — AI 카테고리 수집 소스 추가 (키워드 검색: 네이버 + 구글)
-- 지금은 AI 전용 소스가 요즘IT 하나뿐이라 AI 후보가 거의 없었음. 이미 있는 키워드 검색(MICE·스마트관광 등)과 같은 방식.
-- 적합성 판정 기준에 따라 AI 기사는 1순위(MICE·관광에 AI 적용) > 2순위(화제의 AI 활용·AX 사례) > 3순위(순수 AI 업데이트 소식은 대기열)로 걸러짐.
-- 발행 기간(화·목 창)·소스당 최대 10건·자동 발행 상한 20건은 기존 소스와 동일하게 적용됨.

insert into public.rss_sources (url, source_name, weight, default_category, is_active, source_type, keyword_mode, max_items, fetch_config) values
  ('AI 에이전트',      'AI 에이전트',      6, 'AI', true, 'keyword_search', 'none', 10, '{"engines":["naver","google"]}'::jsonb),
  ('AX 도입 사례',     'AX 도입 사례',     6, 'AI', true, 'keyword_search', 'none', 10, '{"engines":["naver","google"]}'::jsonb),
  ('생성형 AI 업무 활용', '생성형 AI 업무 활용', 6, 'AI', true, 'keyword_search', 'none', 10, '{"engines":["naver","google"]}'::jsonb)
on conflict (url) do nothing;

-- 확인용
select source_name, default_category, is_active, source_type from public.rss_sources where default_category = 'AI' order by source_name;
