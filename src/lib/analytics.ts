import { createClient } from "@/lib/supabase/client";

// category_view: 홈 피드에 해당 카테고리 콘텐츠가 노출된 페이지 로드 1회당 카테고리 수만큼 기록.
// "view"(총 접속 수 KPI 집계 대상)와 분리해 총 접속 수 지표가 부풀려지지 않게 함.
// session_time: 뉴스룸 홈에 진입한 순간부터 이탈할 때까지의 전체 체류시간 (read_time은 인사이트 모달 열람 시간만 측정 — 둘은 별개 지표)
export type EventType = "view" | "detail_view" | "outbound_click" | "event_click" | "read_time" | "search" | "category_view" | "session_time";

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
    const blob = new Blob([JSON.stringify({ event_type: "read_time", news_id, read_sec })], { type: "application/json" });
    navigator.sendBeacon("/api/log-beacon", blob);
  } catch {
    // beacon 실패는 무시
  }
}

/** 홈 화면 전체 체류시간(session_time) 이탈 시 beacon 전송 — logReadTimeBeacon과 동일한 경로, event_type만 다름 */
export function logSessionTimeBeacon(read_sec: number) {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return;
  try {
    const blob = new Blob([JSON.stringify({ event_type: "session_time", read_sec })], { type: "application/json" });
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
