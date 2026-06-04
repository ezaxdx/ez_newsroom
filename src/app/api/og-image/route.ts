import { NextRequest, NextResponse } from "next/server";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Referer": "https://www.google.com/",
};

/** URL 도메인 기반으로 적절한 Referer 반환 */
function getSiteReferer(url: string): string {
  try {
    const { origin } = new URL(url);
    return origin + "/";
  } catch {
    return "https://www.google.com/";
  }
}

/**
 * 네이버 블로그 URL → PostView.naver URL로 변환
 * blog.naver.com/{blogId}/{logNo} 또는 m.blog.naver.com/{blogId}/{logNo}
 */
function resolveNaverBlogUrl(url: string): string {
  const m = url.match(/(?:m\.)?blog\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (!m) return url;
  return `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}&isRedirectFromMobile=true`;
}

function extractImage(html: string, baseUrl: string): string | null {
  // og:image (attribute 순서 두 가지 모두 처리)
  const ogMatch =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

  // twitter:image fallback
  const twitterMatch =
    html.match(/name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

  // 네이버 블로그 본문 이미지 fallback (blogfiles / postfiles)
  const naverImgMatch =
    html.match(/src="(https:\/\/blogfiles\.pstatic\.net[^"]+)"/i) ??
    html.match(/data-lazy-src="(https:\/\/postfiles\.pstatic\.net[^"]+)"/i);

  const rawImage = ogMatch?.[1] ?? twitterMatch?.[1] ?? naverImgMatch?.[1] ?? null;
  if (!rawImage) return null;

  try {
    return new URL(rawImage, baseUrl).href;
  } catch {
    return rawImage;
  }
}

const FALLBACK_IMAGE = "/ez-fallback.png";

async function fetchImage(fetchUrl: string, isNaver: boolean): Promise<string | null> {
  const res = await fetch(fetchUrl, {
    headers: isNaver
      ? { ...BROWSER_HEADERS, Referer: "https://blog.naver.com/" }
      : { ...BROWSER_HEADERS, Referer: getSiteReferer(fetchUrl) },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });

  // EUC-KR 등 non-UTF-8 인코딩 대응
  const contentType = res.headers.get("content-type") ?? "";
  const charsetMatch = contentType.match(/charset=["']?([\w-]+)/i);
  let charset = charsetMatch?.[1]?.toLowerCase() ?? "utf-8";
  if (["euc-kr", "ks_c_5601-1987", "ks_c_5601", "cp949", "x-windows-949"].includes(charset)) {
    charset = "euc-kr";
  }

  let html: string;
  if (charset === "utf-8" || charset === "utf8") {
    html = await res.text();
  } else {
    const buffer = await res.arrayBuffer();
    try { html = new TextDecoder(charset).decode(buffer); }
    catch { html = new TextDecoder("utf-8").decode(buffer); }
  }

  return extractImage(html, fetchUrl);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const query = req.nextUrl.searchParams.get("query"); // 행사명 (네이버 검색용)
  if (!url && !query) return NextResponse.json({ image: FALLBACK_IMAGE }, { status: 400 });

  // 네이버 이미지 검색 우선 시도 (query 파라미터 있을 때)
  if (query) {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (clientId && clientSecret) {
      try {
        const naverRes = await fetch(
          `https://openapi.naver.com/v1/search/image.json?query=${encodeURIComponent(query)}&display=1&sort=sim`,
          {
            headers: {
              "X-Naver-Client-Id": clientId,
              "X-Naver-Client-Secret": clientSecret,
            },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (naverRes.ok) {
          const data = await naverRes.json();
          const item = data?.items?.[0];
          const image = item?.thumbnail ?? item?.link ?? null;
          if (image) return NextResponse.json({ image });
        }
      } catch { /* fallthrough */ }
    }
  }

  if (!url) return NextResponse.json({ image: FALLBACK_IMAGE });

  // 네이버 블로그는 PostView.naver로 변환해서 fetch
  const fetchUrl = resolveNaverBlogUrl(url);
  const isNaver = fetchUrl !== url;

  // 1차 시도
  try {
    const image = await fetchImage(fetchUrl, isNaver);
    if (image) return NextResponse.json({ image });
  } catch { /* 1차 실패 → 재시도 */ }

  // 2차 재시도 (3초 후)
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const image = await fetchImage(fetchUrl, isNaver);
    if (image) return NextResponse.json({ image });
  } catch { /* 2차도 실패 → 폴백 */ }

  // 둘 다 실패 → 회사 로고 폴백
  return NextResponse.json({ image: FALLBACK_IMAGE });
}
