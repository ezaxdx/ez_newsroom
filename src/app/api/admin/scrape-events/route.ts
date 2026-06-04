import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const maxDuration = 10;

/**
 * POST /api/admin/scrape-events
 * 관리자 수동 스크래핑 트리거 — Supabase Edge Function 호출 후 즉시 리턴
 */
export async function POST() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-events`;
  // Supabase Edge Function은 유효한 JWT(service role key)로 인증해야 게이트웨이 통과
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  try {
    await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "X-Cron-Secret": process.env.CRON_SECRET ?? "",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 타임아웃이어도 Edge Function은 계속 실행됨
  }

  return NextResponse.json({ ok: true, message: "스크래핑 시작됨 (백그라운드 실행 중)" });
}
