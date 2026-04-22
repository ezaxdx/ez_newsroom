import { createClient } from "@/lib/supabase/client";

export type EventType = "view" | "detail_view" | "outbound_click";

type LogPayload = {
  event_type: EventType;
  news_id?: string;
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

export async function logEvent(payload: LogPayload) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const supabase = createClient();
    await supabase.from("user_logs").insert({
      event_type: payload.event_type,
      news_id: payload.news_id ?? null,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
      entry_path: typeof window !== "undefined" ? window.location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      ...getUtmParams(),
    });
  } catch {
    // analytics는 non-blocking
  }
}
