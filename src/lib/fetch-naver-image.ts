/**
 * 네이버 이미지 검색 API로 행사 이미지 검색
 * 행사명으로 검색해서 첫 번째 이미지 URL 반환
 */
export async function fetchNaverImage(eventName: string): Promise<string | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const query = encodeURIComponent(eventName);
    const res = await fetch(
      `https://openapi.naver.com/v1/search/image.json?query=${query}&display=1&sort=sim`,
      {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0];
    // thumbnail: 네이버 CDN 캐시 이미지 (핫링크 차단 없어 이메일에서 안정적)
    return item?.thumbnail ?? item?.link ?? null;
  } catch {
    return null;
  }
}
