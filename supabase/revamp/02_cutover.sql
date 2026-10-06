-- ============================================================================
-- [2단계] 소스 데이터 이전 — "전환 시점"에 실행 (크론을 curate-v2 로 바꾸는 순간과 같이)
--
-- ⚠ 지금 실행하면 안 되는 이유: 아직 운영 중인 기존 curate(v1)는 keyword_search / web_list / json_list 를
--   모릅니다. 이 SQL 을 먼저 실행하면 v1 의 네이버 검색이 통째로 빠지고 소스 오류가 납니다.
--   → 순서: ① 이 SQL 실행  ② 곧바로 main 배포(크론이 curate-v2 호출)  ③ 수동으로 live 1회 실행해 확인
--   (다음 정기 실행: 화·목 09:00 KST. 그 전에 ①②를 끝낼 것)
--
-- 설정값은 supabase/revamp/new_sources.json(로컬에서 이미 시험한 설정)과 같습니다.
-- 되돌리기: 99_restore.sql 의 A 블록 (백업 테이블에서 소스 목록 복원)
-- ============================================================================

begin;

-- ── A. 검색 키워드: 네이버 4개 → keyword_search (네이버+구글 동시 검색), 구글 RSS 행은 통합 ──
update public.rss_sources set source_type = 'keyword_search', source_name = '스마트관광', url = '스마트관광',
  keyword_mode = 'none', max_items = 10, fetch_config = '{"engines":["naver","google"]}'::jsonb
 where source_type = 'naver_news' and url = '스마트관광';
update public.rss_sources set source_type = 'keyword_search', source_name = 'AI관광', url = 'AI관광',
  keyword_mode = 'none', max_items = 10, fetch_config = '{"engines":["naver","google"]}'::jsonb
 where source_type = 'naver_news' and lower(url) = 'ai관광';
update public.rss_sources set source_type = 'keyword_search', source_name = '글로컬 관광', url = '"글로컬 관광"',
  keyword_mode = 'none', max_items = 10, fetch_config = '{"engines":["naver","google"]}'::jsonb
 where source_type = 'naver_news' and url = '글로컬관광';
-- ↑ 따옴표로 감싼 "글로컬 관광"은 그 문구가 그대로 들어간 기사만 검색 (미리보기 시험: 대학 기사 14/40건 → 3/40건)
update public.rss_sources set source_type = 'keyword_search', source_name = 'MICE', url = 'MICE',
  keyword_mode = 'none', max_items = 10, fetch_config = '{"engines":["naver","google"]}'::jsonb
 where source_type = 'naver_news' and lower(url) = 'mice';

insert into public.rss_sources (url, source_name, weight, default_category, is_active, source_type, keyword_mode, max_items, fetch_config)
values ('MICE Tech', 'MICE Tech', 6, 'MICE', true, 'keyword_search', 'none', 10, '{"engines":["google"]}'::jsonb)
on conflict (url) do nothing;

-- 구글 RSS 소스 5개(전부 비활성 상태)는 위 키워드에 통합되었으므로 삭제 — 백업 테이블에 남아 있음
delete from public.rss_sources
 where source_type = 'rss' and url like 'https://news.google.com/rss/search%';

-- ── B. 지정 소스 ─────────────────────────────────────────────────────────
-- 마이스iN 블로그: 인증이 필요한 proxy 함수(401) 대신 네이버 직접 주소 사용
update public.rss_sources set url = 'https://rss.blog.naver.com/mice-in.xml', keyword_mode = 'none', max_items = 10
 where source_name = '마이스iN 블로그';

-- 스마트관광신문: 목록 페이지(url) → 이 매체가 제공하는 RSS
update public.rss_sources set source_type = 'rss', url = 'https://www.st-news.co.kr/rss/allArticle.xml', keyword_mode = 'none', max_items = 5
 where source_name = '스마트관광신문' and source_type = 'url';

-- 이데일리 관광·여행: 본문 목록 영역만 사용(사이드바 제외), 제목에 관광·여행이 있는 기사만, 우선순위 보통, 최대 3건
update public.rss_sources set source_type = 'web_list', weight = 5, keyword_mode = 'custom', custom_keywords = array['관광','여행'], max_items = 3,
  fetch_config = $j${"region":{"start":"class=\"aside_left\"","end":"</section>"},"render":false}$j$::jsonb
 where source_name = '이데일리_관광,여행' and source_type = 'url';

-- 오투미트(우리 회사 블로그): 게시판이 불러오는 JSON API 직접 사용, 카테고리 EZPMP 유지
update public.rss_sources set source_type = 'json_list', keyword_mode = 'none', max_items = 3,
  url = 'https://api-d1.o2meet-g.kr/v4/board/post?boardNo=102136&size=10&page=0&projectCd=PORTAL&siteId=999999',
  fetch_config = $j${"list_path":"list","fields":{"title":"title","body":"content","date":"createDt","id":"postNo"},"link_template":"https://o2meet.io/PORTAL/999999/board/news-detail.do?postNo={id}&boardKR=102136","headers":{"Origin":"https://o2meet.io","Referer":"https://o2meet.io/"}}$j$::jsonb
 where source_name = '오투미트' and source_type = 'url';

-- 더벨트(이데일리 관광·MICE 전문): 섹션별 목록 데이터를 POST 로 가져옴. 관광·MICE가 섞여 있어 카테고리는 AI 판단(MIXED)
insert into public.rss_sources (url, source_name, weight, default_category, is_active, source_type, keyword_mode, max_items, fetch_config)
values ('https://thebelt.edaily.co.kr/List/Data/T50', '더벨트', 8, 'MIXED', true, 'web_list', 'none', 5,
  $j${"request":{"method":"POST","form":{"p":"1"},"headers":{"Referer":"https://thebelt.edaily.co.kr/List","Origin":"https://thebelt.edaily.co.kr"}},"urls":["https://thebelt.edaily.co.kr/List/Data/T10","https://thebelt.edaily.co.kr/List/Data/T20","https://thebelt.edaily.co.kr/List/Data/T30","https://thebelt.edaily.co.kr/List/Data/T40","https://thebelt.edaily.co.kr/List/Data/T60"],"render":false}$j$::jsonb)
on conflict (url) do nothing;

-- ── C. 보류(비활성) — 언론사 전체 피드 5개, 주소가 사라진(404) 피드 2개 ─────────────
update public.rss_sources set is_active = false
 where source_type = 'rss' and source_name in ('연합뉴스', '뉴시스', '머니투데이', '전자신문', '이데일리');
update public.rss_sources set is_active = false
 where source_type = 'rss' and source_name in ('대한민국 구석구석', '대한민국 정책브리핑');

-- Gmail 뉴스레터(요즘it, MICE人)·공공 API(한국관광공사_지역별 관광 다양성) 소스 3개 — 수집하지 않기로 확정(2026-10-06), 모두 비활성 상태. 백업 테이블에 남아 있음
delete from public.rss_sources where source_type in ('gmail', 'api');

-- ── D. 기존 "키워드 필터" 체크 → 새 모드로 이전 ───────────────────────────────
update public.rss_sources set keyword_mode = 'default'
 where keyword_filter = true and (keyword_mode is null or keyword_mode = 'none');

commit;

-- 확인용: 방식별 활성/비활성 개수. 기대값(대략) — keyword_search 5 활성, web_list 2 활성, json_list 1 활성, rss 활성 8 안팎
select source_type, is_active, count(*) as cnt
from public.rss_sources
group by source_type, is_active
order by source_type, is_active desc;
