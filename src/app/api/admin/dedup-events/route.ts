import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

const NOISE_NAMES = ["대관 행사", "대관행사", "대관", "행사 대관"];
const NOISE_KEYWORDS = [
  "정기총회", "임시총회", "이사회", "간담회",
  "육아", "웨딩", "wedding",
  "설명회", "공청회", "청문회",
  "임용", "채용", "졸업식", "입학식",
];

type EventRow = {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string | null;
  venue: string;
  venue_region: string | null;
  organizer: string | null;
  website: string | null;
  industry: string | null;
  image_url: string | null;
  event_name_en: string | null;
  is_published: boolean;
};

const GOOGLE_SEARCH_PREFIX = "https://www.google.com/search";

// 필드별 최선값 병합 — 버려지는 행에서 더 나은 값이 있으면 winner에 적용
function mergeFields(rows: EventRow[]): Partial<EventRow> {
  const merged: Partial<EventRow> = {};

  // website: 구글 검색 URL이 아닌 실제 URL 우선
  const realUrl = rows.map(r => r.website).find(w => w && !w.startsWith(GOOGLE_SEARCH_PREFIX));
  const anyUrl  = rows.map(r => r.website).find(w => w);
  merged.website = realUrl ?? anyUrl ?? null;

  // 나머지 필드: null 아닌 첫 번째 값 우선
  const pick = <K extends keyof EventRow>(field: K) =>
    (rows.map(r => r[field]).find(v => v != null) ?? null) as EventRow[K] | null;

  merged.organizer     = pick("organizer");
  merged.industry      = pick("industry");
  merged.venue_region  = pick("venue_region");
  merged.image_url     = pick("image_url");
  merged.event_name_en = pick("event_name_en");

  return merged;
}

async function runDedup(dryRun: boolean) {
  const supabase = createAdminClient();

  const { data: all, error } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, end_date, venue, venue_region, organizer, website, industry, image_url, event_name_en, is_published")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (all ?? []) as EventRow[];

  const toDelete = new Set<string>();

  // 1. 노이즈 행사명 삭제
  const noiseRows = rows.filter((e) => {
    const name = e.event_name?.trim() ?? "";
    const nameLower = name.toLowerCase();
    return NOISE_NAMES.some((n) => name === n)
      || NOISE_KEYWORDS.some((kw) => nameLower.includes(kw.toLowerCase()));
  });
  noiseRows.forEach((e) => toDelete.add(e.id));

  // 2. 중복 그룹화 (event_name + start_date 완전 일치)
  const groups = new Map<string, EventRow[]>();
  for (const e of rows) {
    if (toDelete.has(e.id)) continue;
    const key = `${e.event_name?.trim()}|${e.start_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  type MergeDetail = { keep_id: string; keep_name: string; discard_ids: string[]; merged_fields: string[] };
  const dupDetails: MergeDetail[] = [];
  const toUpdate: { id: string; fields: Partial<EventRow> }[] = [];

  for (const [, groupRows] of groups) {
    if (groupRows.length <= 1) continue;

    // 스코어링: 실제 website(비구글) > website 있음 > 나머지 non-null 필드
    const scored = groupRows.map((r) => ({
      ...r,
      score:
        [r.organizer, r.website, r.industry, r.venue_region, r.image_url, r.event_name_en].filter(Boolean).length +
        (r.website && !r.website.startsWith(GOOGLE_SEARCH_PREFIX) ? 3 : r.website ? 1 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);

    const winner  = scored[0];
    const discard = scored.slice(1);
    discard.forEach((r) => toDelete.add(r.id));

    // 필드 병합: 모든 행(winner 포함)을 대상으로 최선값 계산
    const merged = mergeFields(scored);

    // winner와 다른 필드만 추출
    const fieldsToUpdate: Partial<EventRow> = {};
    const mergedFieldNames: string[] = [];
    for (const [k, v] of Object.entries(merged) as [keyof EventRow, unknown][]) {
      if (winner[k] !== v) {
        (fieldsToUpdate as Record<string, unknown>)[k] = v;
        mergedFieldNames.push(k);
      }
    }

    if (Object.keys(fieldsToUpdate).length > 0) {
      toUpdate.push({ id: winner.id, fields: fieldsToUpdate });
    }

    dupDetails.push({
      keep_id: winner.id,
      keep_name: winner.event_name,
      discard_ids: discard.map(r => r.id),
      merged_fields: mergedFieldNames,
    });
  }

  if (!dryRun) {
    // 병합 업데이트 (winner 행 필드 보강)
    for (const { id, fields } of toUpdate) {
      await supabase.from("convention_events").update(fields).eq("id", id);
    }

    // 중복/노이즈 삭제
    const ids = [...toDelete];
    const BATCH = 100;
    for (let i = 0; i < ids.length; i += BATCH) {
      const { error: delErr } = await supabase
        .from("convention_events")
        .delete()
        .in("id", ids.slice(i, i + BATCH));
      if (delErr) throw new Error(delErr.message);
    }
  }

  return {
    noise: noiseRows.length,
    dup: toDelete.size - noiseRows.length,
    total_delete: toDelete.size,
    merged_updates: toUpdate.length,
    dry_run: dryRun,
    dup_groups: dupDetails.length,
    details: dupDetails,
  };
}

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  try {
    const result = await runDedup(true);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json().catch(() => ({}));

  if (Array.isArray(body.ids)) {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("convention_events")
      .delete()
      .in("id", body.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: body.ids.length });
  }

  const dryRun = body.dry_run === true;
  try {
    const result = await runDedup(dryRun);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
