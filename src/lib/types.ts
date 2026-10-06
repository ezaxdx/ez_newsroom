export type NewsItem = {
  id: string;
  title: string;
  summary_short: string;
  content_long: string;
  implications: string;
  image_url: string | null;
  original_url: string;
  category: string;
  level: "Beginner" | "Intermediate" | "Advanced" | null;
  priority_score: number;
  is_published: boolean;
  display_order: number;
  published_at: string;
  quality_score?: number | null;
  quality_criteria?: {
    relevance: number;
    specificity: number;
    practicality: number;
    source_quality: number;
    fit?: number; // 회사(MICE·관광) 적합성 — 2026-07 이후 생성분부터 존재
  } | null;
  business_domains?: string[]; // AI가 생성 시점에 직접 분류한 EZPMP 7대 사업영역 — 이후 생성분부터 존재
  faithfulness_score?: number | null; // 원문 대비 충실도 재검증 점수(1~10) — audit-content 실행분부터 존재
  faithfulness_issues?: string[] | null;
  audited_at?: string | null;
  audit_dismissed_at?: string | null; // 관리자가 "확인했으나 수정 안 함"으로 완료처리한 시각
  category_edited?: boolean;          // 관리자가 카테고리를 직접 고친 기사
  category_reason?: string | null;    // AI가 카테고리를 판단한 경우의 근거 한 줄
  related_event_id?: string | null;   // 이즈픽 행사 관련 기사면 그 행사 id
  fit_reason?: string | null;         // AI 적합성 판정 근거 한 줄
  created_at?: string;
};

export type ApiConfig = {
  endpoint: string;          // e.g. "/areaTouDivList"
  service_key_env: string;   // env var name, e.g. "TOURAPI_SERVICE_KEY"
  params: Record<string, string>; // extra params; use "auto" for baseYm to auto-compute
  data_path: string;         // dot-notation path to items array, e.g. "response.body.items.item"
  context_hint: string;      // human-readable description for Gemini context
};

export type GmailConfig = {
  sender_filter: string;   // 발신자 이메일 필터 (예: "noreply@yozm.wishket.com")
  subject_filter?: string; // 선택적 제목 키워드 필터
  max_emails: number;      // 가져올 최대 이메일 수
};

/** 목록 수집 설정 (웹페이지 목록·JSON API·검색 키워드) — rss_sources.fetch_config */
export type FetchConfig = {
  request?: { method?: string; form?: Record<string, string>; headers?: Record<string, string> };
  region?: { start: string; end?: string };   // 페이지에서 본문 목록 영역만 사용
  link_pattern?: string;
  urls?: string[];                            // 같은 방식으로 추가 수집할 주소들
  render?: boolean;                           // true: 렌더링 서비스 사용 / false: 안 씀 / 미지정: 0건이면 자동
  list_path?: string;                         // JSON API
  fields?: { title?: string; body?: string; date?: string; id?: string; link?: string };
  link_template?: string;
  headers?: Record<string, string>;
  engines?: string[];                         // 검색 키워드: ["naver","google"]
};

export type SourceType =
  | "keyword_search" | "rss" | "web_list" | "json_list"        // 현재 방식
  | "url" | "api" | "gmail" | "naver_news";                    // 이전 방식 (전환 전 데이터에만 존재)

export type KeywordMode = "none" | "default" | "custom";

export type RssSource = {
  id: string;
  url: string;
  source_name: string;
  weight: number;
  default_category: string;   // MICE | TOURISM | AI | EZPMP | MIXED(섞여 있음 → AI 판단)
  is_active: boolean;
  source_type: SourceType;
  api_config?: ApiConfig | GmailConfig | null;
  keyword_filter?: boolean;   // (이전 방식) true면 관심 키워드 매칭 기사만 수집
  keyword_mode?: KeywordMode | null;
  custom_keywords?: string[] | null;
  max_items?: number | null;
  fetch_config?: FetchConfig | null;
  last_run_at?: string | null;
  last_status?: "ok" | "empty" | "error" | "not_run" | null;
  last_fetched?: number | null;
  zero_streak?: number | null;
  last_error?: string | null;
};

export type CurationSettings = {
  id: string;
  target_audience: string;
  focus_keywords: string[];
  persona_prompt: string;
};

export type UserLog = {
  id: string;
  event_type: "view" | "detail_view" | "outbound_click";
  news_id: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  entry_path: string | null;
  user_agent: string | null;
  created_at: string;
};
