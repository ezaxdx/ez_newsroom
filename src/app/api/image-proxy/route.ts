import { NextRequest, NextResponse } from "next/server";

/**
 * 외부 이미지 프록시
 * 이메일 HTML에서 외부 이미지를 자체 도메인을 통해 로드 (Gmail CORS 우회)
 */
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
    return new NextResponse("유효하지 않은 URL입니다.", { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new NextResponse("허용되지 않는 URL 스킴입니다.", { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EZNewsroom/1.0; +https://ez-newsroom.vercel.app)",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return new NextResponse(`이미지 가져오기 실패: ${response.status}`, {
        status: response.status,
      });
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return new NextResponse("이미지 파일이 아닙니다.", { status: 400 });
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
    return new NextResponse("이미지를 불러올 수 없습니다.", { status: 502 });
  }
}
