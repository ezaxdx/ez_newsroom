import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * 외부 이미지 프록시
 * 이메일 HTML에서 외부 이미지를 자체 도메인을 통해 로드 (Gmail CORS 우회)
 *
 * 원본 이미지를 못 가져오면(핫링크 차단, 삭제됨, 접근 불가 등) 뉴스룸(ArticleImg)과
 * 동일하게 EZPMP 로고로 대체함 — 이메일 클라이언트는 onError 같은 JS 폴백을
 * 못 쓰므로 프록시 단에서 처리해야 함. 여기서 실패를 흡수하지 않으면 이 프록시를
 * 거치는 뉴스레터 이미지가 그대로 깨진 이미지 아이콘으로 보임
 */
async function fallbackLogoResponse(): Promise<NextResponse> {
  const buffer = await readFile(path.join(process.cwd(), "public", "ez-fallback.png"));
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("url 파라미터가 필요합니다.", { status: 400 });
  }

  // http/https 스킴만 허용
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fallbackLogoResponse();
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fallbackLogoResponse();
  }

  try {
    // Referer: 이미지 원본 도메인으로 설정 → 핫링크 보호 우회
    const referer = `${parsed.protocol}//${parsed.host}/`;
    const response = await fetch(url, {
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
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return fallbackLogoResponse();
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return fallbackLogoResponse();
    }

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[image-proxy] fetch error:", err);
    return fallbackLogoResponse();
  }
}
