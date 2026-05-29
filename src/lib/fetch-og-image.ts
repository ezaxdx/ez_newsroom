/**
 * 이벤트 website URL에서 og:image 메타태그 추출
 * image_url이 없을 때 fallback으로 사용
 */
export async function fetchOgImage(url: string | null): Promise<string | null> {
  if (!url || url.startsWith("https://www.google.com")) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4초 타임아웃

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();

    // og:image 추출
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    if (ogMatch?.[1]) {
      const imgUrl = ogMatch[1];
      // 상대경로면 절대경로로 변환
      if (imgUrl.startsWith("//")) return `https:${imgUrl}`;
      if (imgUrl.startsWith("/")) {
        const base = new URL(url);
        return `${base.origin}${imgUrl}`;
      }
      return imgUrl;
    }

    return null;
  } catch {
    return null;
  }
}
