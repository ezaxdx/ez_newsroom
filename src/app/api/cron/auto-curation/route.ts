import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dayKST = nowKST.getUTCDay();
  const hourKST = nowKST.getUTCHours();

  if (!schedule.days.includes(dayKST) || hourKST !== schedule.hour) {
    return NextResponse.json({
      skipped: `not scheduled (day=${dayKST}, hour=${hourKST})`,
    });
  }

  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/api/admin/run-curation`, { method: "POST" });
    const result = await res.json();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
