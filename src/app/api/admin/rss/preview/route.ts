import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const maxDuration = 60;

// POST: 소스·키워드 미리보기 — 저장하기 전에 실제로 기사가 수집되는지 확인 (읽기 전용, DB에 아무것도 쓰지 않음)
// 실제 수집과 같은 서버에서 같은 코드로 돌리기 위해 curate-v2 Edge 함수의 preview 모드를 호출
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const preview = await req.json();
  const supabase = createAdminClient();
  const { data: settings } = await supabase.from("curation_settings").select("focus_keywords").limit(1).single();

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return NextResponse.json({ ok: false, items: [], total: 0, error: "서버 설정(CRON_SECRET)이 없습니다" }, { status: 500 });

  try {
    const res = await fetch(`${base}/functions/v1/curate-v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ preview: { ...preview, focus_keywords: settings?.focus_keywords ?? [] } }),
      signal: AbortSignal.timeout(58000),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, items: [], total: 0, error: `미리보기 요청 실패: ${(e as Error).message}` }, { status: 502 });
  }
}
