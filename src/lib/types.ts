export type NewsItem = {
  id: string;
  title: string;
  summary_short: string;
  content_long: string;
  implications: string;
  image_url: string | null;
  original_url: string;
  category: string;
  priority_score: number;
  is_published: boolean;
  display_order: number;
  published_at: string;
};

export type RssSource = {
  id: string;
  url: string;
  source_name: string;
  weight: number;
  default_category: string;
  is_active: boolean;
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
