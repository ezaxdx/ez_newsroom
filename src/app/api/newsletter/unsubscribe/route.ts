import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 이메일 클라이언트/보안 스캐너가 링크를 미리 열어보는 경우가 있어(prefetch),
// GET에서 바로 수신거부하지 않고 확인 페이지만 보여준 뒤 실제 처리는 POST(사용자가 버튼을 눌러야만 발생)에서 수행.

function page(title: string, body: string): NextResponse {
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:'Noto Sans KR',sans-serif;">
  <div style="max-width:420px;margin:60px auto;background:#fff;border:1px solid #000;padding:40px 32px;text-align:center;">
    ${body}
  </div>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return page("잘못된 요청", `<p style="color:#7A6E5F;">유효하지 않은 링크입니다.</p>`);

  const supabase = createAdminClient();
  const { data: sub } = await supabase
    .from("newsletter_subscribers").select("email, unsubscribed_at").eq("id", id).single();

  if (!sub) return page("잘못된 요청", `<p style="color:#7A6E5F;">해당 구독 정보를 찾을 수 없습니다.</p>`);

  if (sub.unsubscribed_at) {
    return page("이미 수신거부됨", `<p style="font-size:15px;color:#423C25;">${sub.email}<br>이미 수신거부 처리된 이메일입니다.</p>`);
  }

  return page("수신거부 확인", `
    <p style="font-size:15px;color:#423C25;margin-bottom:24px;">
      <strong>${sub.email}</strong><br>이 이메일로 더 이상 EZ Letter를 받지 않으시겠습니까?
    </p>
    <form method="POST">
      <input type="hidden" name="id" value="${id}">
      <button type="submit" style="background:#54713B;color:#fff;border:none;padding:12px 28px;font-size:14px;cursor:pointer;">수신거부 확인</button>
    </form>
  `);
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  let id: string | null = null;
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    id = body.id ?? null;
  } else {
    const form = await req.formData();
    id = (form.get("id") as string) ?? null;
  }
  if (!id) return page("잘못된 요청", `<p style="color:#7A6E5F;">유효하지 않은 요청입니다.</p>`);

  const supabase = createAdminClient();
  // 전사 발송 특성상 수신거부해도 실제 발송은 계속되어야 함 — is_active는 건드리지 않고 수신거부 의사만 기록(집계용)
  const { data: sub, error } = await supabase
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", id)
    .select("email")
    .single();

  if (error || !sub) return page("처리 실패", `<p style="color:#7A6E5F;">해당 구독 정보를 찾을 수 없습니다.</p>`);

  return page("수신거부 완료", `<p style="font-size:15px;color:#423C25;">${sub.email}<br>수신거부가 완료되었습니다.</p>`);
}
