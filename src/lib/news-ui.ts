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
export function getCategoryBg(_category: string, _imageUrl: string | null): string {
  return "var(--surface-container-highest)";
}

/** 이미지 없을 때 사용할 EZpmp 로고 폴백 */
export const FALLBACK_IMAGE = "/ez-fallback.png";

/** image_url이 없으면 EZpmp 로고로 대체 */
export function getArticleImage(imageUrl: string | null | undefined): string {
  return imageUrl || FALLBACK_IMAGE;
}

/** 실제 기사 이미지가 있는지 여부 (폴백 URL 저장된 경우도 없음으로 처리) */
export function hasRealImage(imageUrl: string | null | undefined): boolean {
  return !!imageUrl && imageUrl !== FALLBACK_IMAGE;
}

/** img onLoad 핸들러 — HTTP 200이지만 빈/손상 이미지(naturalWidth<5)도 폴백으로 교체 */
export function onImgLoad(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  if (img.src.endsWith(FALLBACK_IMAGE)) return;
  if (img.naturalWidth < 5 || img.naturalHeight < 5) {
    onImgError(e);
  }
}

/** img onError 핸들러 — 로드 실패 시 EZpmp 로고로 교체 + 중앙 정렬 소형 표시 */
export function onImgError(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  if (img.src.endsWith(FALLBACK_IMAGE)) return; // 무한 루프 방지
  img.src = FALLBACK_IMAGE;
  img.style.position = "absolute";
  img.style.inset = "auto";
  img.style.top = "50%";
  img.style.left = "50%";
  img.style.transform = "translate(-50%, -50%)";
  img.style.width = "38%";
  img.style.height = "auto";
  img.style.objectFit = "contain";
  img.style.padding = "0";
}
