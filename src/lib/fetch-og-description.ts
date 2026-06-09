/**
 * 이벤트 website URL에서 행사 소개 텍스트 추출
 * 우선순위: og:description → meta description → 페이지 내 소개 텍스트
 */
export async function fetchOgDescription(url: string | null): Promise<string | null> {
  if (!url || url.startsWith("https://www.google.com")) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

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

    // 1) og:description
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,200})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{10,200})["'][^>]+property=["']og:description["']/i);
    if (ogMatch?.[1]) return cleanDesc(ogMatch[1]);

    // 2) meta description
    const metaMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,200})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{10,200})["'][^>]+name=["']description["']/i);
    if (metaMatch?.[1]) return cleanDesc(metaMatch[1]);

    return null;
  } catch {
    return null;
  }
}

function cleanDesc(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    // 60자 이내로 자르기 (문장 부호 기준 우선, 없으면 60자에서 절단)
    .replace(/^(.{1,60})[.!?。].*$/, "$1")
    .slice(0, 60)
    .replace(/[,\s]+$/, "");
}
