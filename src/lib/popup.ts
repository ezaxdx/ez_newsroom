import { createAdminClient } from "@/lib/supabase/admin";
import type { PopupData } from "@/components/newsroom/PopupBanner";

// 팝업이 뜰 수 있는 공개 페이지
export const POPUP_PAGES = [
  { key: "home",     label: "홈" },
  { key: "category", label: "아카이브" },
  { key: "events",   label: "행사 캘린더" },
  { key: "archive",  label: "뉴스레터 지난호" },
] as const;

export type PopupPageKey = typeof POPUP_PAGES[number]["key"];

/**
 * 오늘 노출할 팝업 1건 — 게시기간 안 + 사용중인 것 중 최근 등록순.
 * 어느 페이지에 실제로 그릴지는 pages/random_page를 보고 클라이언트(PopupBanner)가 판단한다.
 */
export async function fetchActivePopup(): Promise<PopupData | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const supabase = createAdminClient();
    // KST 기준 오늘 날짜 — 서버가 UTC면 자정 전후로 하루 어긋날 수 있음
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("newsroom_popups")
      .select("id, title, image_url, link_url, content, display_type, position, pages, random_page")
      .eq("is_active", true)
      .lte("start_date", today)
      .gte("end_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}
