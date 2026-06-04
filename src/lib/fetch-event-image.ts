import { fetchNaverImage } from "@/lib/fetch-naver-image";
import { fetchOgImage } from "@/lib/fetch-og-image";

/**
 * 행사 이미지 우선순위:
 * 1. 네이버 이미지 검색 (행사명으로 전경/포스터 검색)
 * 2. 웹사이트 og:image
 * 3. DB image_url (마음에 안 들 때 관리자가 직접 설정)
 * 4. null → 템플릿에서 EZ 로고 플레이스홀더
 */
export async function fetchEventImage(
  eventName: string,
  website: string | null,
  imageUrl: string | null
): Promise<string | null> {
  // 1. 네이버 이미지 검색
  const naverImage = await fetchNaverImage(eventName);
  if (naverImage) return naverImage;

  // 2. 웹사이트 og:image
  const ogImage = await fetchOgImage(website);
  if (ogImage) return ogImage;

  // 3. DB 직접 설정값 (관리자가 수동 지정한 경우)
  if (imageUrl) return imageUrl;

  return null;
}
