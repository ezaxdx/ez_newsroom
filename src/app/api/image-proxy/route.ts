import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { unwrapNextImageUrl } from "@/lib/unwrap-image-url";
import { fetchRemoteImage } from "@/lib/fetch-remote-image";

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
      // 일시적인 실패로 만든 대체 이미지가 브라우저·CDN에 하루 동안 저장되면 사이트가 정상으로 돌아와도 로고가 계속 보이므로 저장하지 않음
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// 처음 요청이 느려 실패하는 경우가 있어 한 번 더 시도
async function fetchImage(url: string): Promise<Response | null> {
  return (await fetchRemoteImage(url)) ?? (await fetchRemoteImage(url));
}

export const maxDuration = 30;   // 시도 2회(각 8초) + 여유

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

  const unwrapped = unwrapNextImageUrl(url);
  const candidates = unwrapped ? [unwrapped, url] : [url];

  for (const candidate of candidates) {
    const response = await fetchImage(candidate);
    if (!response) continue;
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return fallbackLogoResponse();
}
