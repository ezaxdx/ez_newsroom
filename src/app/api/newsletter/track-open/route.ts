import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 1x1 투명 GIF — 메일 클라이언트가 이 이미지를 불러오면(=메일을 열면) 요청이 찍힘
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

function pixelResponse(): NextResponse {
  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const issueId = req.nextUrl.searchParams.get("issue");
  const subId = req.nextUrl.searchParams.get("sub");

  // 자리표시자가 치환되지 않은 채로 온 경우(dry_run 미리보기 등) 등 유효하지 않으면 조용히 픽셀만 반환
  if (!issueId || !subId || !UUID_RE.test(issueId) || !UUID_RE.test(subId)) return pixelResponse();

  try {
    const supabase = createAdminClient();
    const { data: sub } = await supabase
      .from("newsletter_subscribers").select("email").eq("id", subId).single();
    if (sub?.email) {
      // 최초 오픈만 기록 — 이미 opened_at이 있으면 갱신하지 않음
      await supabase
        .from("newsletter_send_logs")
        .update({ opened_at: new Date().toISOString() })
        .eq("issue_id", issueId)
        .eq("email", sub.email)
        .is("opened_at", null);
    }
  } catch {
    // 트래킹 실패해도 이미지 로딩엔 영향 없어야 함
  }

  return pixelResponse();
}
