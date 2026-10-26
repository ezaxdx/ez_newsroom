import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// Supabase Edge Function으로 위임 — 150초 실행 가능 (Supabase 무료 플랜)
// Vercel 함수는 단순 프록시 역할만 수행

export const maxDuration = 60;

export async function POST() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  // curate-v2 는 안전을 위해 기본이 "시험 실행(저장 안 함)" — 실제 수집은 live: true 를 보내야 함
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/curate-v2`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  try {
    const res = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ live: true, trigger: "manual" }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[run-curation proxy 오류]", e);
    return NextResponse.json({ error: "큐레이션 접수를 확인하지 못했습니다. 실행 로그를 확인해 주세요." }, { status: 500 });
  }
}
