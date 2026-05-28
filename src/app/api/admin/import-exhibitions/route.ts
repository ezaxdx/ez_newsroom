import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const maxDuration = 60;

// AKEI 엑셀 행 타입
type AkeiRow = {
  title_kr_ge?: string;
  host_ge?: string;
  start_dt?: string;
  end_dt?: string;
  place_ge?: string;
  type_ge?: string;
  url_ge?: string;
  [key: string]: unknown;
};

// place_ge 문자열에서 대표 venue_region 추출
const VENUE_MAP: [RegExp, string][] = [
  [/코엑스|COEX/i,                  "코엑스"],
  [/킨텍스|KINTEX/i,                "킨텍스"],
  [/벡스코|BEXCO/i,                 "벡스코"],
  [/세텍|SETEC/i,                   "세텍"],
  [/엑스코|EXCO/i,                  "엑스코"],
  [/창원컨벤션|CECO/i,              "창원CECO"],
  [/김대중컨벤션|KDJ/i,             "김대중컨벤션"],
  [/제주국제컨벤션|ICC JEJU/i,      "ICC 제주"],
  [/aT센터|at센터/i,               "aT센터"],
  [/동대문디자인|DDP/i,             "DDP"],
  [/양재|AT센터/i,                  "양재"],
  [/일산|고양/i,                    "일산·고양"],
  [/부산/i,                         "부산"],
  [/대구/i,                         "대구"],
  [/광주/i,                         "광주"],
  [/대전/i,                         "대전"],
  [/제주/i,                         "제주"],
];

function extractVenueRegion(place: string): string {
  for (const [pattern, region] of VENUE_MAP) {
    if (pattern.test(place)) return region;
  }
  return "";
}

// AKEI 행 → convention_events 행 변환
function mapRow(row: AkeiRow) {
  const place = String(row.place_ge ?? "").trim();
  const name  = String(row.title_kr_ge ?? "").trim();
  const start = String(row.start_dt ?? "").trim();
  if (!name || !start) return null;

  return {
    event_name:   name,
    organizer:    String(row.host_ge ?? "").trim() || null,
    start_date:   start,
    end_date:     String(row.end_dt ?? "").trim() || null,
    venue:        place || null,
    venue_region: extractVenueRegion(place) || null,
    category:     String(row.type_ge ?? "").trim() || null,
    website:      String(row.url_ge ?? "").trim() || null,
    is_published: true,
  };
}

/**
 * POST /api/admin/import-exhibitions
 * body: { rows: AkeiRow[], dry_run: boolean }
 *
 * dry_run=true  → 미리보기 (실제 DB 변경 없음)
 * dry_run=false → upsert 실행
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { rows, dry_run } = (await req.json()) as { rows: AkeiRow[]; dry_run: boolean };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows 필드가 필요합니다" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 현재 DB 행사 목록 가져오기 (중복 판단용)
  const { data: existing } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, organizer, venue, category, website, end_date, venue_region");

  // (event_name, start_date) → 기존 행 맵
  const existingMap = new Map<string, typeof existing extends (infer T)[] | null ? T : never>();
  for (const e of existing ?? []) {
    existingMap.set(`${e.event_name}||${e.start_date}`, e);
  }

  // 각 row 분류
  const toInsert: ReturnType<typeof mapRow>[]  = [];
  const toMerge:  { id: string; patch: Record<string, string | null> }[] = [];
  const skipped:  string[] = [];

  for (const raw of rows) {
    const mapped = mapRow(raw);
    if (!mapped) continue;

    const key = `${mapped.event_name}||${mapped.start_date}`;
    const existing_row = existingMap.get(key);

    if (!existing_row) {
      toInsert.push(mapped);
    } else {
      // 빈 필드만 채우는 MERGE 패치 계산
      const patch: Record<string, string | null> = {};
      if (!existing_row.organizer    && mapped.organizer)    patch.organizer    = mapped.organizer;
      if (!existing_row.venue        && mapped.venue)        patch.venue        = mapped.venue;
      if (!existing_row.venue_region && mapped.venue_region) patch.venue_region = mapped.venue_region;
      if (!existing_row.category     && mapped.category)     patch.category     = mapped.category;
      if (!existing_row.website      && mapped.website)      patch.website      = mapped.website;
      if (!existing_row.end_date     && mapped.end_date)     patch.end_date     = mapped.end_date;

      if (Object.keys(patch).length > 0) {
        toMerge.push({ id: existing_row.id, patch });
      } else {
        skipped.push(mapped.event_name);
      }
    }
  }

  // 미리보기 모드 — DB 변경 없이 통계만 반환
  if (dry_run) {
    return NextResponse.json({
      new_count:   toInsert.length,
      merge_count: toMerge.length,
      skip_count:  skipped.length,
      preview_new:   toInsert.slice(0, 5).map((r) => ({ name: r?.event_name, date: r?.start_date, venue: r?.venue })),
      preview_merge: toMerge.slice(0, 5).map((m) => {
        const e = [...existingMap.values()].find((x) => x.id === m.id);
        return { name: e?.event_name, date: e?.start_date, fields: Object.keys(m.patch) };
      }),
    });
  }

  // 실제 실행
  let inserted = 0;
  let updated  = 0;
  const errors: string[] = [];

  // 신규 insert (배치 100건씩)
  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100).filter(Boolean);
    const { error } = await supabase.from("convention_events").insert(batch);
    if (error) errors.push(`insert batch ${i}: ${error.message}`);
    else inserted += batch.length;
  }

  // MERGE update (개별)
  for (const { id, patch } of toMerge) {
    const { error } = await supabase
      .from("convention_events")
      .update(patch)
      .eq("id", id);
    if (error) errors.push(`update ${id}: ${error.message}`);
    else updated++;
  }

  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    skipped: skipped.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
}
