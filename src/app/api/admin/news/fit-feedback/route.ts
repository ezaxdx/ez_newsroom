import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { addFitExample } from "@/lib/fit-examples";
import { normalizeUrl } from "@/lib/normalize-url";

/**
 * 큐레이션 보드의 적합성 학습 표시.
 *  - verdict "good": 좋은 기사 — 제목을 적합 예시(fit 9)로 쌓기만 함 (기사는 그대로)
 *  - verdict "bad":  부적합 — 제목·사유를 부적합 예시(fit 2)로 쌓고, URL을 curation_seen(admin_rejected)에 남겨
 *                    다시 수집되지 않게 한 뒤 기사 삭제. (중복·오류로 지우는 일반 삭제와 달리 학습에 쓰임)
 * 쌓인 예시는 다음 큐레이션의 적합성 판정(curate-v2 judgeFit)에 들어감.
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { id, verdict, reason } = await req.json();
  if (!id || (verdict !== "good" && verdict !== "bad")) {
    return NextResponse.json({ error: "id, verdict(good|bad) 필요" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: item, error: readErr } = await supabase.from("news").select("title, original_title, original_url").eq("id", id).single();
  if (readErr || !item) return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });

  // 판정은 AI가 보는 원 제목 기준이 더 정확함 (보드 제목은 AI가 다시 쓴 것)
  const exTitle = (item.original_title || item.title) as string;
  const exErr = await addFitExample(supabase, { title: exTitle, kind: verdict, note: typeof reason === "string" ? reason : undefined });
  if (exErr) {
    const hint = /fit_examples/.test(exErr) ? " (supabase/revamp/11_fit_examples.sql 을 먼저 실행해야 합니다)" : "";
    return NextResponse.json({ error: `학습 사례 저장 실패: ${exErr}${hint}` }, { status: 500 });
  }

  if (verdict === "bad") {
    if (item.original_url) {
      const { error: seenErr } = await supabase.from("curation_seen").upsert({
        url_key: normalizeUrl(item.original_url), original_url: item.original_url,
        reason: "admin_rejected", title: exTitle.slice(0, 200), seen_at: new Date().toISOString(),
      }, { onConflict: "url_key" });
      if (seenErr) return NextResponse.json({ error: `재수집 차단 기록 실패: ${seenErr.message}` }, { status: 500 });
    }
    const { error: delErr } = await supabase.from("news").delete().eq("id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    revalidatePath("/");
  }

  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
