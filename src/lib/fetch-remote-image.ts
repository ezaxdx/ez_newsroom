/**
 * 외부 이미지 가져오기 — 이미지 프록시(/api/image-proxy)와 뉴스레터 생성 시 접근 확인이 같은 요청을 쓰도록 한 곳에 둠.
 * 둘이 서로 다른 헤더로 요청하면 "프록시는 되는데 확인 단계에서 막혀 로고로 대체"되는 불일치가 생김.
 * Referer 는 이미지 원본 도메인으로 설정해 핫링크 보호를 우회함.
 */
export async function fetchRemoteImage(url: string, timeoutMs = 8000): Promise<Response | null> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  try {
    const referer = `${parsed.protocol}//${parsed.host}/`;
    const response = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": referer,
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "same-site",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    return response;
  } catch (err) {
    console.error("[fetch-remote-image] fetch error:", url, err);
    return null;
  }
}
