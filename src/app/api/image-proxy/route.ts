import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// 실패 시 반환할 EZ 로고 플레이스홀더 SVG
function makePlaceholderSVG(origin: string): string {
  const logoUrl = `${origin}/images/ez-letter-logo.png`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="255" height="129" viewBox="0 0 255 129">
  <rect width="255" height="129" fill="#EEEBE5"/>
  <image href="${logoUrl}" x="87" y="39" width="80" height="50" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

function placeholderResponse(origin: string) {
  return new NextResponse(makePlaceholderSVG(origin), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return placeholderResponse(origin);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return placeholderResponse(origin);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return placeholderResponse(origin);
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!res.ok) return placeholderResponse(origin);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return placeholderResponse(origin);

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return placeholderResponse(origin);
  }
}
