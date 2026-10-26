import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { fetchRemoteImage } from "@/lib/fetch-remote-image";

/**
 * 외부 이미지 프록시
 * 이메일 HTML에서 외부 이미지를 자체 도메인을 통해 로드
 *
 * 원본 이미지를 못 가져오면(핫링크 차단, 삭제됨, 접근 불가 등) 뉴스룸(ArticleImg)과
 * 동일하게 EZPMP 로고로 대체함 — 이메일 클라이언트는 onError 같은 JS 폴백을
 * 못 쓰므로 프록시 단에서 처리해야 함. 여기서 실패를 흡수하지 않으면 이 프록시를
 * 거치는 뉴스레터 이미지가 그대로 깨진 이미지 아이콘으로 보임
 */
async function fallbackLogoResponse(): Promise<NextResponse> {
  // 뉴스레터 카드(255x129) 비율에 맞춘 "EZ Letter" 자리표시 — 회사 로고(ez-fallback.png)를 카드에 꽉 채우면 옆으로 늘어나 보였음
  const buffer = await readFile(path.join(process.cwd(), "public", "images", "ez-letter-placeholder.png"));
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

export const maxDuration = 30; // 전체 다운로드 12초 + 이미지 변환·응답 여유

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

  const buffer = await fetchRemoteImage(url, 12000, req.nextUrl.searchParams.get("ref") ?? undefined);
  if (buffer) {
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return fallbackLogoResponse();
}
