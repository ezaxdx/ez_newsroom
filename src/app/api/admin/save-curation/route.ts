import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { NewsItem } from "@/lib/types";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const body=await req.json().catch(()=>null);
  if(!body || typeof body!=="object")return NextResponse.json({error:"저장 요청 형식을 확인해주세요."},{status:400});
  const {
    items,
    deletedIds,
    republishIds,
    orderReason, orderNote, requestId,
  }: { items: NewsItem[]; deletedIds?: string[]; republishIds?: string[]; orderReason?: string; orderNote?: string; requestId?: string } = body;
  if (!Array.isArray(items) || items.length>500 || (deletedIds && (!Array.isArray(deletedIds)||deletedIds.length>500))
    || (republishIds && (!Array.isArray(republishIds)||republishIds.length>500))
    || (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    || (Array.isArray(items) && items.some(i=>!i || typeof i.id!=="string" || !Number.isInteger(i.display_order) || typeof i.is_published!=="boolean"))
    || (orderReason && !["business","timing","readers","balance","personal"].includes(orderReason))) {
    return NextResponse.json({ error: "저장 항목과 순서 변경 사유를 확인해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 순서/발행 상태 업데이트
  if (!items.length && !deletedIds?.length && !republishIds?.length) {
    revalidatePath("/");
    revalidatePath("/admin");
    return NextResponse.json({ ok: true });
  }

  const { data: currentStates } = await supabase
    .from("news")
    .select("id, is_published, level, title, original_title")
    .in("id", items.map((i) => i.id));

  const saveToken=requestId || crypto.randomUUID();
  const { data: historyCount, error: saveError } = await supabase.rpc("save_curation_items", {
    p_items:items.map(item=>({id:item.id,is_published:item.is_published,display_order:item.display_order,level:item.level})),
    p_reason:orderReason || null,p_note:typeof orderNote === "string" ? orderNote.slice(0,500) : null,
    p_request_id:saveToken,p_deleted:deletedIds??[],p_republish:republishIds??[],
  });
  if (saveError) {
    console.error("[save-curation] 저장 실패",{requestId:saveToken,code:saveError.code});
    const invalid=/^(22|23)/.test(saveError.code??"") || saveError.code==="P0001";
    return NextResponse.json({error:saveError.message,request_id:saveToken},{status:invalid?409:503});
  }

  // 관리자가 레벨을 직접 고친 기사는 사례로 누적 — 다음 큐레이션부터 비슷한 기사의 레벨 판정에 참고됨
  // (카테고리·사업영역 보정과 같은 방식). level_examples 컬럼이 아직 없어도 저장 자체는 막지 않음.
  try {
    const before = new Map((currentStates ?? []).map((s) => [s.id, s]));
    const changed = items
      .map((i) => ({ i, cur: before.get(i.id) }))
      .filter(({ i, cur }) => cur && i.level && cur.level && i.level !== cur.level)
      .map(({ i, cur }) => ({ title: (cur!.original_title || cur!.title) as string, level: i.level as string }));
    if (changed.length) {
      const { data: settings } = await supabase.from("curation_settings").select("id, level_examples").limit(1).single();
      if (settings?.id) {
        const existing: { title: string; level: string }[] = Array.isArray(settings.level_examples) ? settings.level_examples : [];
        const titles = new Set(changed.map((c) => c.title));
        const next = [...changed, ...existing.filter((e) => !titles.has(e.title))].slice(0, 30);
        await supabase.from("curation_settings").update({ level_examples: next }).eq("id", settings.id);
      }
    }
  } catch (e) {
    console.warn("[save-curation] 레벨 사례 누적 실패(무시):", e);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, order_history_recorded: historyCount });
}

export async function GET() {
  const unauth = await requireAdmin(); if (unauth) return unauth;
  const { data, error } = await createAdminClient().from("curation_order_history")
    .select("id,created_at,window_end,category,automatic_order,before_order,after_order,reason,note")
    .order("created_at", { ascending: false }).limit(10);
  return NextResponse.json(error ? { error:error.message } : { data }, { status:error ? 500 : 200 });
}
