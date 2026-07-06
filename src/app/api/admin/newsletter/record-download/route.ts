import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST: HTML 다운로드 시 Vol 번호 + 발송일 기록 (스티비 발송용)
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { vol_number, send_date, editorial_text } = await req.json() as {
    vol_number: number;
    send_date: string;
    editorial_text?: string;
  };

  if (!vol_number || !send_date)
    return NextResponse.json({ error: "vol_number, send_date 필요" }, { status: 400 });

  const supabase = createAdminClient();

  // 이미 같은 vol_number가 있으면 중복 저장 안 함
  const { data: existing } = await supabase
    .from("newsletter_issues")
    .select("id, vol_number")
    .eq("vol_number", vol_number)
    .single();

  if (existing) {
    return NextResponse.json({ ok: true, issue_id: existing.id, vol_number, already_exists: true });
  }

  const { data: issue, error } = await supabase
    .from("newsletter_issues")
    .insert({
      vol_number,
      editorial_text: editorial_text ?? "",
      status: "sent",
      total_sent: 0,
      total_failed: 0,
      target_count: 0,
      sent_at: new Date(`${send_date}T09:00:00+09:00`).toISOString(),
    })
    .select("id")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, issue_id: issue.id, vol_number });
}
