/**
 * 뉴스 카드 UI 공통 상수 & 유틸리티
 * CategoryArchive / FeedBlock / InsightGrid / HeroCarousel 등에서 공유
 */

/** 밝은 배경(카드 썸네일 위) 레벨 뱃지 스타일 */
export const LEVEL_STYLE_LIGHT: Record<string, { bg: string; color: string }> = {
  Beginner:     { bg: "var(--surface-container-highest)", color: "var(--on-surface-variant)" },
  Intermediate: { bg: "rgba(26,28,29,0.72)",              color: "#fff" },
  Advanced:     { bg: "var(--primary)",                   color: "#fff" },
};

/** 어두운 배경(InsightGrid · HeroCarousel 히어로) 레벨 뱃지 스타일 */
export const LEVEL_STYLE_DARK: Record<string, { bg: string; color: string }> = {
  Beginner:     { bg: "rgba(255,255,255,0.18)", color: "#fff" },
  Intermediate: { bg: "rgba(255,255,255,0.18)", color: "#fff" },
  Advanced:     { bg: "var(--primary)",         color: "#fff" },
};

/** 이미지 없을 때 카테고리별 그라디언트 배경 */
export const CATEGORY_GRADIENT: Record<string, string> = {
  AI:      "radial-gradient(circle at 60% 40%, #1a3a5c, #0d1b2a)",
  MICE:    "radial-gradient(circle at 60% 40%, #1a3a2a, #0d1f16)",
  TOURISM: "radial-gradient(circle at 60% 40%, #3a2a1a, #1f150d)",
};

/** 이미지 없을 때 카테고리 그라디언트 또는 기본 surface 반환 */
export function getCategoryBg(category: string, imageUrl: string | null): string {
  if (imageUrl) return "var(--surface-container-highest)";
  return CATEGORY_GRADIENT[category.toUpperCase()] ?? "var(--surface-container-highest)";
}

/** 이미지 없을 때 사용할 EZpmp 로고 폴백 */
export const FALLBACK_IMAGE = "/ez-fallback.png";

/** image_url이 없으면 EZpmp 로고로 대체 */
export function getArticleImage(imageUrl: string | null | undefined): string {
  return imageUrl || FALLBACK_IMAGE;
}
