import { createClient } from "@/lib/supabase/client";

export type EventType = "view" | "detail_view" | "outbound_click" | "event_click" | "read_time" | "search";

type LogPayload = {
  event_type: EventType;
  news_id?: string;
  event_id?: string;
  category?: string;
  read_sec?: number;
  search_query?: string;
};

function getUtmParams() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utm_source: p.get("utm_source"),
    utm_medium: p.get("utm_medium"),
    utm_campaign: p.get("utm_campaign"),
  };
}

/**
 * 페이지 이탈(탭 닫기·다른 사이트 이동) 순간에 호출 — 일반 fetch는 이탈 중 취소될 수 있어
 * navigator.sendBeacon()으로 같은 출처 API 라우트(/api/log-beacon)에 안정적으로 전송.
 */
export function logReadTimeBeacon(news_id: string, read_sec: number) {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return;
  try {
    const blob = new Blob([JSON.stringify({ news_id, read_sec })], { type: "application/json" });
    navigator.sendBeacon("/api/log-beacon", blob);
  } catch {
    // beacon 실패는 무시
  }
}

export async function logEvent(payload: LogPayload) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  // 로컬 개발 환경에서는 로그 기록 안 함
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return;
  try {
    const supabase = createClient();
    await supabase.from("user_logs").insert({
      event_type:    payload.event_type,
      news_id:       payload.news_id      ?? null,
      event_id:      payload.event_id     ?? null,
      category:      payload.category     ?? null,
      read_sec:      payload.read_sec     ?? null,
      search_query:  payload.search_query ?? null,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
      entry_path: typeof window !== "undefined" ? window.location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      ...getUtmParams(),
    });
  } catch {
    // analytics는 non-blocking
  }
}
