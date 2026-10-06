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

const POPUP_SELECT =
  "id, title, image_url, link_url, content, content_overrides, display_type, position, pages, random_page, size_px, pos_x, pos_y, effect";

/**
 * 오늘 노출 가능한 팝업 전체 — 게시기간 안 + 사용중.
 * 표시 방식(고정/팝업)별로 최신 1건씩만 반환한다.
 * 어느 페이지에 실제로 그릴지는 pages/random_page를 보고 클라이언트가 판단한다.
 */
export async function fetchActivePopups(): Promise<PopupData[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  try {
    const supabase = createAdminClient();
    // start_date/end_date는 timestamptz — 지금 이 순간이 게시 기간 안에 있는지 시각까지 비교
    const now = new Date().toISOString();
    const { data } = await supabase
      .from("newsroom_popups")
      .select(POPUP_SELECT)
      .eq("is_active", true)
      .lte("start_date", now)
      .gte("end_date", now)
      .is("hunt_code", null)   // 종료한 숨은 그림 찾기 팝업(DB 에 남아 있어도)은 노출하지 않음
      .order("created_at", { ascending: false });

    const rows: PopupData[] = data ?? [];
    // 같은 표시 방식(고정/팝업)끼리는 화면이 겹치므로 각각 가장 최근 것 하나만 노출.
    // 고정(구석 배너)과 팝업(화면 중앙)은 서로 다른 영역이라 겹치지 않으므로 동시에 띄운다.
    const normalByType = new Map<string, PopupData>();
    for (const p of rows) {
      if (!normalByType.has(p.display_type)) normalByType.set(p.display_type, p);
    }
    const normal = Array.from(normalByType.values());
    return normal;
  } catch {
    return [];
  }
}
