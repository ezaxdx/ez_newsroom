import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * 관리자 쿠키 검증 헬퍼
 * 인증 실패 시 401 Response 반환, 성공 시 null 반환
 *
 * 사용법:
 *   const unauth = requireAdmin();
 *   if (unauth) return unauth;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get("admin_auth")?.value;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || cookie !== adminPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
