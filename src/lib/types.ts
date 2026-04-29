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

export type RssSource = {
  id: string;
  url: string;
  source_name: string;
  weight: number;
  default_category: string;
  is_active: boolean;
  source_type: "rss" | "url" | "api" | "gmail";
  api_config?: ApiConfig | GmailConfig | null;
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
