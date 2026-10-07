import type { NewsItem } from "@/lib/types";

// 큐레이션 보드 카드에 필요한 컬럼만 — 본문(content_long)·시사점·감사 결과 같은 큰 컬럼은 뺌(기사당 약 2KB).
// 편집 창·카테고리 다시 쓰기 창이 열릴 때만 /api/admin/news/detail 로 그 기사 한 건을 따로 읽는다.
export const NEWS_CARD_COLUMNS =
  "id, title, summary_short, image_url, original_url, category, level, priority_score, is_published, display_order, published_at, " +
  "quality_score, quality_criteria, category_edited, category_reason, fit_reason, created_at";

/** DB 행(카드용 컬럼) → NewsItem. 목록에서는 읽지 않는 본문·시사점은 빈 문자열로 둠 */
export function toCardItem(row: Record<string, unknown>): NewsItem {
  return { content_long: "", implications: "", ...row } as unknown as NewsItem;
}
