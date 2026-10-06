-- ============================================================================
-- [복원] 큐레이션 개편 이전 상태로 되돌리기 — 문제가 생겼을 때만 사용
-- 00_backup.sql 로 만든 백업 테이블(backup_20261006_*)에서 원본 데이터를 되살림
-- 새로 추가된 컬럼·테이블은 그대로 두어도 기존 동작에 영향이 없으므로 지우지 않음
-- 한 블록씩 필요한 것만 골라서 실행할 것
-- ============================================================================

-- ── A. rss_sources 복원 (소스 목록을 개편 전 상태로) ──────────────────────
-- 먼저 위험 확인: 아래가 9 컬럼(개편 전 컬럼)만 복원함. 신규 컬럼은 기본값으로 돌아감
-- begin;
--   delete from public.rss_sources;
--   insert into public.rss_sources (id, url, source_name, weight, default_category, is_active, source_type, api_config, keyword_filter)
--   select id, url, source_name, weight, default_category, is_active, source_type, api_config, keyword_filter
--   from public.backup_20261006_rss_sources;
-- commit;

-- ── B. curation_settings 복원 (개편 전 설정값으로) ────────────────────────
-- update public.curation_settings s set
--   target_audience = b.target_audience, focus_keywords = b.focus_keywords, persona_prompt = b.persona_prompt,
--   nav_categories = b.nav_categories, carousel_interval_sec = b.carousel_interval_sec,
--   category_settings = b.category_settings, level_prompts = b.level_prompts, auto_schedule = b.auto_schedule,
--   quality_thresholds = b.quality_thresholds, company_context = b.company_context,
--   business_domain_examples = b.business_domain_examples, content_quality_notes = b.content_quality_notes,
--   newsletter_header_images = b.newsletter_header_images, newsletter_footer_banner = b.newsletter_footer_banner
-- from public.backup_20261006_curation_settings b
-- where s.id = b.id;

-- ── C. convention_events 복원 (행사 데이터가 잘못 바뀐 경우) ──────────────
-- 행사 개별 행만 되돌리려면 id 조건을 붙여서 사용:
-- update public.convention_events e set
--   event_name = b.event_name, start_date = b.start_date, end_date = b.end_date,
--   is_published = b.is_published, is_ezpmp_pick = b.is_ezpmp_pick
-- from public.backup_20261006_convention_events b
-- where e.id = b.id and e.id = '<되돌릴 행사 id>';

-- ── D. 백업 테이블 정리 (개편이 안정화된 뒤, 더 이상 필요 없을 때) ────────
-- drop table if exists public.backup_20261006_rss_sources;
-- drop table if exists public.backup_20261006_curation_settings;
-- drop table if exists public.backup_20261006_convention_events;
