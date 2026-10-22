import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";
import { addFitExample } from "@/lib/fit-examples";
import { normalizeUrl } from "@/lib/normalize-url";

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await req.json();

  const supabase = createClient(supabaseUrl, serviceKey);

  // display_order 고정값(0)을 쓰면 같은 날 여러 건 직접 작성 시 전부 겹쳐서
  // 관리자/메인 정렬이 동률 처리 순서에 따라 서로 다르게 보임 — 그 카테고리
  // 현재 라이브 중 최솟값보다 하나 낮은 값을 매번 계산해 겹치지 않게 함
  let display_order = 0;
  if (body.is_published && body.category) {
    const { data: lowest } = await supabase
      .from("news")
      .select("display_order")
      .eq("is_published", true)
      .eq("category", body.category)
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (lowest) display_order = lowest.display_order - 1;
  }

  const payload = {
    title: body.title,
    summary_short: body.summary_short,
    content_long: body.content_long,
    implications: body.implications,
    image_url: body.image_url || null,
    original_url: body.original_url || null,
    category: body.category,
    level: body.level ?? "Intermediate",
    quality_score: body.quality_score ?? null,
    quality_criteria: body.quality_criteria ?? null,
    is_published: body.is_published ?? false,
    priority_score: 100,
    display_order,
    published_at: new Date().toISOString(),
  };

  // 항상 신규 insert — 같은 URL의 살아있는 기사를 실수로 덮어쓰지 않기 위함.
  // 큐레이션 보드에서 실제로 삭제(+저장)된 URL은 행이 사라진 상태라 그대로 재작성 가능하고,
  // 아직 삭제되지 않은(=살아있는) URL이면 유니크 제약으로 막혀 안전하게 실패함.
  const { data, error } = await supabase.from("news").insert(payload).select().single();

  if (error) {
    // 유니크 제약 위반(23505) = 같은 URL 기사가 아직 존재함 → 친절한 안내로 교체
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "이미 등록된 URL입니다. 큐레이션 보드에서 해당 기사를 삭제하고 '변경사항 저장'까지 완료한 뒤 다시 시도하세요." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 큐레이션(curate)을 거치지 않는 수동 발행이라 그쪽의 자동 감사 트리거를 못 탐 — 여기서 직접 깨움.
  // await하지 않음(기다리면 "기사 발행" 버튼이 최대 수십 초 멈춰버려 저장 자체가 느려짐) — 그냥 시도만
  // 하고 응답은 바로 반환. 이 요청이 중간에 끊기더라도 다음 curate 실행 때 자동 감사가 다시 훑으므로
  // 결국은 감사됨 — 여기서는 "되면 좋고, 안 되도 그만"인 best-effort 트리거.
  if (payload.is_published) {
    fetch(`${supabaseUrl}/functions/v1/audit-content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    }).catch(() => {});
  }

  // 직접 작성한 기사 = 관리자가 "실을 만하다"고 고른 기사 → 적합성 판정 예시로 쌓음 (이즈픽은 판정 면제라 제외)
  // 실패해도 저장 자체는 성공이므로 응답을 막지 않음
  if (body.category !== "EZPMP" && body.title) {
    await addFitExample(supabase, { title: body.title, kind: "manual" }).catch(() => null);
  }

  return NextResponse.json({ data, collect: body.original_url ? await diagnoseCollection(supabase, body.original_url) : null });
}

// 이 원문을 자동 큐레이션이 왜 못 가져왔는지 — 수집은 됐는데 AI가 버렸는지(discarded), 그 매체를 보는 소스가 아예 없는지(no_source)
async function diagnoseCollection(supabase: SupabaseClient, originalUrl: string) {
  const key = normalizeUrl(originalUrl);
  const host = key.split("/")[0] ?? "";
  const { data: seen } = await supabase.from("curation_seen").select("reason").eq("url_key", key).maybeSingle();
  if (seen) return { status: "discarded" as const, reason: seen.reason as string, host };
  const { data: sources } = await supabase.from("rss_sources").select("url").eq("is_active", true);
  const hasSource = (sources ?? []).some((s) => normalizeUrl(s.url).split("/")[0] === host);
  return { status: hasSource ? ("has_source" as const) : ("no_source" as const), host };
}
