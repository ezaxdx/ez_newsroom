import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

// 행사 수집 변경 내역 — 검토 대기열(신규·일정 변경 의심·값 변경·사라진 행사)과 처리 이력
// 테이블/컬럼은 supabase/revamp/06_event_changes.sql

const EVENT_COLS = "id, event_name, venue, venue_region, category, organizer, start_date, end_date, website, image_url, is_published, is_ezpmp_pick, source, created_at";
const FIELD_ALLOWED = ["end_date", "organizer", "website"] as const;

type Change = {
  id: string; created_at: string; resolved_at: string | null; kind: string; status: string; resolution: string | null;
  event_id: string | null; source: string | null; dedupe_key: string; payload: Record<string, unknown>;
};
type Candidate = {
  event_name: string; event_name_en: string | null; start_date: string; end_date: string | null;
  venue: string; venue_region: string | null; location: string | null; category: string | null; industry: string | null;
  organizer: string | null; image_url: string | null; website: string | null; source: string;
};

const candidateRow = (cand: Candidate) => ({
  venue: cand.venue, venue_region: cand.venue_region, event_name: cand.event_name, event_name_en: cand.event_name_en,
  start_date: cand.start_date, end_date: cand.end_date, location: cand.location, category: cand.category,
  industry: cand.industry, organizer: cand.organizer, image_url: cand.image_url, website: cand.website,
  is_published: true, source: cand.source,
});

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();

  const { data: pending, error } = await supabase
    .from("event_changes").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ pending: [], history: [], unavailable: true, error: error.message });

  const { data: history } = await supabase
    .from("event_changes").select("*").in("status", ["applied", "reverted"]).order("resolved_at", { ascending: false }).limit(40);

  const ids = [...new Set([...(pending ?? []), ...(history ?? [])].map((c: Change) => c.event_id).filter(Boolean))] as string[];
  const events: Record<string, unknown> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("convention_events").select(EVENT_COLS).in("id", ids.slice(i, i + 200));
    for (const e of data ?? []) events[(e as { id: string }).id] = e;
  }
  const withEvent = (c: Change) => ({ ...c, event: c.event_id ? events[c.event_id] ?? null : null });
  return NextResponse.json({ pending: (pending ?? []).map(withEvent), history: (history ?? []).map(withEvent) });
}

/**
 * POST /api/admin/event-changes
 * body: { id, action } | { ids: string[], action }(여러 건 한 번에 — 같은 액션을 각각 적용) | { action: "ack_all_new" }
 *   date_suspect : date_changed(일정 변경 — 기존 행사의 일정을 새 값으로) | keep_old(변경 안 함 — 기존 일정이 맞음, 소스 값 무시) | separate(타 행사 — 새로 등록하고 다시 묻지 않음)
 *   duplicate_suspect : same(동일 행사 — 기존 행사에 빈 필드만 채움) | other(타 행사 — 새로 등록하고 다시 묻지 않음)
 *   concurrent   : group(+parent_id: 대표 행사를 고르면 나머지를 동시개최로 연결) | separate(각각 별개 행사)
 *   field_change : apply(소스 값으로 반영) | dismiss(유지)
 *   missing      : hide(비공개 처리) | keep(유지)
 *   new          : ack(확인) | hide(비공개 처리)
 *   처리 이력의 일정 변경·값 변경은 revert(되돌리기) 가능
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const body = (await req.json()) as { id?: string; ids?: string[]; action?: string; parent_id?: string };

  // 여러 건 일괄 처리 — 건별로 같은 처리를 적용하고 결과(patch/added)를 모아서 돌려줌. 일부 실패해도 나머지는 진행
  if (Array.isArray(body.ids) && body.action) {
    const patches: unknown[] = []; const added: unknown[] = []; const failed: { id: string; error: string }[] = [];
    const queue = [...body.ids]; let done = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        const res = await processOne({ id, action: body.action });
        const json = await res.json();
        if (!res.ok) { failed.push({ id, error: json.error ?? "처리 실패" }); continue; }
        done++;
        if (json.patch) patches.push(json.patch);
        for (const p of json.patches ?? []) patches.push(p);
        if (json.added) added.push(json.added);
      }
    }));
    return NextResponse.json({ ok: failed.length === 0, count: done, patches, addedList: added, failed });
  }
  return processOne(body);
}

async function processOne(body: { id?: string; action?: string; parent_id?: string }): Promise<NextResponse> {
  const { id, action } = body;
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  if (action === "ack_all_new") {
    const { data, error } = await supabase.from("event_changes")
      .update({ status: "dismissed", resolution: "acknowledged", resolved_at: now })
      .eq("kind", "new").eq("status", "pending").select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: data?.length ?? 0 });
  }

  if (!id || !action) return NextResponse.json({ error: "id, action required" }, { status: 400 });
  const { data: ch, error: chErr } = await supabase.from("event_changes").select("*").eq("id", id).single();
  if (chErr || !ch) return NextResponse.json({ error: "변경 내역을 찾을 수 없습니다" }, { status: 404 });
  const c = ch as Change;
  const resolve = (status: string, resolution: string, payload?: Record<string, unknown>) =>
    supabase.from("event_changes").update({ status, resolution, resolved_at: now, ...(payload ? { payload } : {}) }).eq("id", id);

  // 행사 한 건 수정 + 잠금 (공개 상태를 바꿀 때) — 결과로 바뀐 필드를 돌려줌
  const patchEvent = async (fields: Record<string, unknown>) => {
    if (!c.event_id) return { error: "행사가 없습니다" };
    const { error } = await supabase.from("convention_events").update(fields).eq("id", c.event_id);
    return { error: error?.message };
  };
  // 비공개 + 잠금 + 사유 기록 — 05/07 SQL 적용 전이면 없는 컬럼은 빼고 재시도
  const hide = async (reason: "manual" | "missing") => {
    let r = await patchEvent({ is_published: false, publish_locked: true, hidden_reason: reason });
    if (r.error && /hidden_reason/.test(r.error)) r = await patchEvent({ is_published: false, publish_locked: true });
    if (r.error && /publish_locked/.test(r.error)) r = await patchEvent({ is_published: false });
    return r;
  };
  const fail = (msg: string) => NextResponse.json({ error: msg }, { status: 500 });

  // ── 신규 ──
  if (c.kind === "new") {
    if (action === "ack") { await resolve("dismissed", "acknowledged"); return NextResponse.json({ ok: true }); }
    if (action === "hide") {
      const r = await hide("manual"); if (r.error) return fail(r.error);
      await resolve("dismissed", "hidden");
      return NextResponse.json({ ok: true, patch: { id: c.event_id, fields: { is_published: false, hidden_reason: "manual" } } });
    }
  }

  // ── 사라진 행사 ──
  if (c.kind === "missing") {
    if (action === "keep") { await resolve("dismissed", "kept"); return NextResponse.json({ ok: true }); }
    if (action === "hide") {
      const r = await hide("missing"); if (r.error) return fail(r.error);
      await resolve("dismissed", "hidden");
      return NextResponse.json({ ok: true, patch: { id: c.event_id, fields: { is_published: false, hidden_reason: "missing" } } });
    }
  }

  // ── 동일 행사 의심 ── (같은 날 같은 주최·장소에 이름이 비슷한 행사)
  if (c.kind === "duplicate_suspect") {
    const cand = c.payload.candidate as Candidate;
    if (action === "same") {
      // 동일 행사 — 새로 등록하지 않고 기존 행사의 빈 필드만 소스 값으로 채움. 같은 후보는 다음 수집에서도 다시 묻지 않음
      const { data: ex } = await supabase.from("convention_events").select("*").eq("id", c.event_id!).single();
      const fields: Record<string, unknown> = {};
      const fill: (keyof Candidate)[] = ["event_name_en", "organizer", "industry", "image_url", "website", "category", "venue_region", "location"];
      for (const f of fill) if (ex && !(ex as Record<string, unknown>)[f] && cand[f]) fields[f] = cand[f];
      if (Object.keys(fields).length) { const r = await patchEvent(fields); if (r.error) return fail(r.error); }
      await resolve("dismissed", "merged");
      return NextResponse.json({ ok: true, patch: Object.keys(fields).length ? { id: c.event_id, fields } : undefined });
    }
    if (action === "other") {
      const { data, error } = await supabase.from("convention_events").insert(candidateRow(cand)).select(EVENT_COLS).single();
      if (error) return fail(error.message);
      await resolve("dismissed", "separate");
      return NextResponse.json({ ok: true, added: data });
    }
  }

  // ── 동시개최 묶음 ── (같은 주최·날짜·장소 — 대표 행사를 고르면 나머지가 딸린 행사로 연결)
  if (c.kind === "concurrent") {
    const members = (c.payload.members ?? []) as { id: string; name: string }[];
    if (action === "separate") { await resolve("dismissed", "separate"); return NextResponse.json({ ok: true }); }
    if (action === "group") {
      const parentId = body.parent_id;
      if (!parentId || !members.some((m) => m.id === parentId)) return NextResponse.json({ error: "대표 행사를 선택하세요" }, { status: 400 });
      const childIds = members.filter((m) => m.id !== parentId).map((m) => m.id);
      const { error: e1 } = await supabase.from("convention_events").update({ is_concurrent: false, parent_event_id: null }).eq("id", parentId);
      if (e1) return fail(e1.message);
      const { error: e2 } = await supabase.from("convention_events").update({ is_concurrent: true, parent_event_id: parentId }).in("id", childIds);
      if (e2) return fail(e2.message);
      await resolve("applied", "grouped", { ...c.payload, parent_id: parentId });
      return NextResponse.json({
        ok: true,
        patches: [
          { id: parentId, fields: { is_concurrent: false, parent_event_id: null } },
          ...childIds.map((id) => ({ id, fields: { is_concurrent: true, parent_event_id: parentId } })),
        ],
      });
    }
    if (action === "revert" && c.status === "applied") {
      const ids = members.map((m) => m.id);
      const { error: e } = await supabase.from("convention_events").update({ is_concurrent: false, parent_event_id: null }).in("id", ids);
      if (e) return fail(e.message);
      await resolve("reverted", "reverted");
      return NextResponse.json({ ok: true, patches: ids.map((id) => ({ id, fields: { is_concurrent: false, parent_event_id: null } })) });
    }
  }

  // ── 값 변경 ──
  if (c.kind === "field_change") {
    const field = String(c.payload.field) as (typeof FIELD_ALLOWED)[number];
    if (!FIELD_ALLOWED.includes(field)) return NextResponse.json({ error: "허용되지 않는 필드" }, { status: 400 });
    if (action === "dismiss") { await resolve("dismissed", "kept"); return NextResponse.json({ ok: true }); }
    if (action === "apply") {
      const r = await patchEvent({ [field]: c.payload.new }); if (r.error) return fail(r.error);
      await resolve("applied", "applied");
      return NextResponse.json({ ok: true, patch: { id: c.event_id, fields: { [field]: c.payload.new } } });
    }
    if (action === "revert" && c.status === "applied") {
      const r = await patchEvent({ [field]: c.payload.old }); if (r.error) return fail(r.error);
      await resolve("reverted", "reverted");
      return NextResponse.json({ ok: true, patch: { id: c.event_id, fields: { [field]: c.payload.old } } });
    }
  }

  // ── 일정 변경 의심 ──
  if (c.kind === "date_suspect") {
    const cand = c.payload.candidate as Candidate;
    const old = c.payload.old as { start_date: string; end_date: string | null };
    if (action === "date_changed") {
      // 같은 행(ID)의 일정만 새 값으로 — 공개 여부·이즈픽·뉴스 연결은 그대로. 옛 값은 payload.old 에 남아 되돌리기 가능
      const fields = { start_date: cand.start_date, end_date: cand.end_date };
      const r = await patchEvent(fields); if (r.error) return fail(r.error);
      await resolve("applied", "date_changed");
      return NextResponse.json({ ok: true, patch: { id: c.event_id, fields } });
    }
    if (action === "revert" && c.status === "applied" && c.resolution === "date_changed") {
      const fields = { start_date: old.start_date, end_date: old.end_date };
      const r = await patchEvent(fields); if (r.error) return fail(r.error);
      await resolve("reverted", "reverted");
      return NextResponse.json({ ok: true, patch: { id: c.event_id, fields } });
    }
    if (action === "keep_old") {
      // 변경 안 함 — 기존 일정이 맞고 소스 값이 틀린 경우. 같은 짝은 dedupe_key 때문에 다시 묻지 않음
      await resolve("dismissed", "kept_old");
      return NextResponse.json({ ok: true });
    }
    if (action === "separate") {
      // 타 행사 — 새로 등록. dedupe_key 가 남아 있어 다음 수집부터 같은 짝을 다시 묻지 않음
      const { data, error } = await supabase.from("convention_events").insert(candidateRow(cand)).select(EVENT_COLS).single();
      if (error) return fail(error.message);
      await resolve("dismissed", "separate");
      return NextResponse.json({ ok: true, added: data });
    }
  }

  return NextResponse.json({ error: `처리할 수 없는 요청입니다 (${c.kind}/${action}/${c.status})` }, { status: 400 });
}
