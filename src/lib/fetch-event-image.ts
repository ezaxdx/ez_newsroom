import { fetchNaverImage } from "@/lib/fetch-naver-image";
import { fetchOgImage } from "@/lib/fetch-og-image";

/**
 * 행사 이미지 우선순위:
 * 1. DB image_url (관리자가 직접 설정한 경우 최우선)
 * 2. 네이버 이미지 검색 (행사명으로 전경/포스터 검색)
 * 3. 웹사이트 og:image
 * 4. null → 템플릿에서 EZ 로고 플레이스홀더
 */
export async function fetchEventImage(
  eventName: string,
  website: string | null,
  imageUrl: string | null
): Promise<string | null> {
  // 1. DB 직접 설정값 (관리자가 수동 지정한 경우 최우선)
  if (imageUrl) return imageUrl;

  // 2. 네이버 이미지 검색
  const naverImage = await fetchNaverImage(eventName);
  if (naverImage) return naverImage;

  // 3. 웹사이트 og:image
  const ogImage = await fetchOgImage(website);
  if (ogImage) return ogImage;

  return null;
}
