import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 공개 엔드포인트 — navigator.sendBeacon()으로 페이지 이탈(탭 닫기·다른 사이트 이동) 시에도
// 안정적으로 체류시간 로그를 전송하기 위한 전용 경로. sendBeacon은 커스텀 헤더를 못 붙이므로
// 같은 출처(same-origin) API 라우트로 받아서 서버가 대신 기록한다.
// read_time(기사 인사이트 모달 열람) · session_time(홈 화면 전체 체류) 두 개만 허용 — 임의 쓰기 방지 위해 payload를 엄격히 제한.

const MAX_READ_SEC = 600;    // 10분 — 모달 열람 이상치 방어
const MAX_SESSION_SEC = 1800; // 30분 — 홈 체류 이상치 방어

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event_type = body.event_type === "session_time" ? "session_time" : "read_time";
    const read_sec = typeof body.read_sec === "number" ? body.read_sec : null;
    if (!read_sec || read_sec < 1) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    if (event_type === "read_time") {
      const news_id = typeof body.news_id === "string" ? body.news_id : null;
      if (!news_id) return NextResponse.json({ ok: false }, { status: 400 });
      const supabase = createAdminClient();
      await supabase.from("user_logs").insert({
        event_type: "read_time",
        news_id,
        read_sec: Math.min(Math.round(read_sec), MAX_READ_SEC),
      });
    } else {
      const supabase = createAdminClient();
      await supabase.from("user_logs").insert({
        event_type: "session_time",
        read_sec: Math.min(Math.round(read_sec), MAX_SESSION_SEC),
      });
    }
    return NextResponse.json({ ok: true });
  } catch {
    // 이탈 시 전송이라 실패해도 사용자에게 알릴 방법이 없음 — 조용히 무시
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
