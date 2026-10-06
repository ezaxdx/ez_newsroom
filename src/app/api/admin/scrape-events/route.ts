import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { triggerEventScrape } from "@/lib/trigger-event-scrape";

export const maxDuration = 15;

/**
 * POST /api/admin/scrape-events
 * 관리자 수동 수집 트리거 — 소스별 Edge Function 호출 후 즉시 리턴
 */
export async function POST() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  await triggerEventScrape();
  return NextResponse.json({ ok: true, message: "수집 시작됨 (백그라운드 실행 중)" });
}
