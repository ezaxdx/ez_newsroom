import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 로그인 페이지와 auth API는 통과
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }

  // /admin/* 경로 보호
  if (pathname.startsWith("/admin")) {
    const cookie = req.cookies.get("admin_auth")?.value;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || cookie !== adminPassword) {
      const loginUrl = new URL("/admin/login", req.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
