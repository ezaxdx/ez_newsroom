import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/verify-cron";
import { triggerEventScrape } from "@/lib/trigger-event-scrape";

export const maxDuration = 15;

/**
 * Vercel Cron: 분기별(1·4·7·10월 1일) 09:00 KST (00:00 UTC) 자동 실행
 * 실제 수집은 Supabase Edge Function(scrape-events)이 소스별로 수행 (각 최대 150s)
 * 이 라우트는 트리거만 하고 즉시 리턴 — 결과·실패는 scrape_logs 와 디스코드로 확인
 */
export async function GET(req: Request) {
  const unauth = verifyCronAuth(req);
  if (unauth) return unauth;

  await triggerEventScrape();
  return NextResponse.json({ ok: true, message: "행사 수집 시작됨 (AKEI·KEOA·쇼알라)" });
}
