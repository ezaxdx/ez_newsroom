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

export type EventSettings = {
  enabled: boolean;
  title: string;
  form_url: string | null;
  total: number; // 등록된 찾기 대상(고양이) 수
};

const POPUP_SELECT =
  "id, title, image_url, link_url, content, display_type, position, pages, random_page, hunt_code, size_px, pos_x, pos_y, effect";

/**
 * 오늘 노출 가능한 팝업 전체 — 게시기간 안 + 사용중.
 * 일반 팝업은 최신 1건만, 찾기 이벤트(hunt_code 있음)는 전부 반환한다.
 * 어느 페이지에 실제로 그릴지는 pages/random_page를 보고 클라이언트가 판단한다.
 */
export async function fetchActivePopups(): Promise<PopupData[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  try {
    const supabase = createAdminClient();
    // KST 기준 오늘 날짜 — 서버가 UTC면 자정 전후로 하루 어긋날 수 있음
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("newsroom_popups")
      .select(POPUP_SELECT)
      .eq("is_active", true)
      .lte("start_date", today)
      .gte("end_date", today)
      .order("created_at", { ascending: false });

    const rows: PopupData[] = data ?? [];
    const hunts = rows.filter((p) => p.hunt_code);
    // 일반 팝업이 여러 개면 화면이 겹치므로 가장 최근 것 하나만 노출
    const normal = rows.filter((p) => !p.hunt_code).slice(0, 1);
    return [...hunts, ...normal];
  } catch {
    return [];
  }
}

export async function fetchEventSettings(): Promise<EventSettings | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const supabase = createAdminClient();
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [{ data: settings }, { count }] = await Promise.all([
      supabase
        .from("newsroom_event_settings")
        .select("enabled, title, form_url")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("newsroom_popups")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .not("hunt_code", "is", null)
        .lte("start_date", today)
        .gte("end_date", today),
    ]);
    if (!settings) return null;
    return { ...settings, total: count ?? 0 };
  } catch {
    return null;
  }
}
