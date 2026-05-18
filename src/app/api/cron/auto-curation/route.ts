import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 10;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("curation_settings")
    .select("auto_schedule")
    .limit(1)
    .single();

  const schedule = data?.auto_schedule ?? { enabled: false, days: [], hour: 9 };

  if (!schedule.enabled) {
    return NextResponse.json({ skipped: "auto schedule disabled" });
  }

  // Vercel Hobby 플랜은 최대 1시간 지연 실행 → hour 체크 제거, day만 확인
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dayKST = nowKST.getUTCDay();

  if (!schedule.days.includes(dayKST)) {
    return NextResponse.json({ skipped: `not scheduled (day=${dayKST})` });
  }

  // Edge Function 직접 호출 — fire-and-forget (Hobby 10초 타임아웃 회피)
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/curate`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  fetch(edgeFnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cronSecret}`,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: "큐레이션 시작됨 (백그라운드 실행 중)" });
}
