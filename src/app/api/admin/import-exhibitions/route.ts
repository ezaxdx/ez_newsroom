import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { addToIndex, matchEvent, noiseReason, type DateIndex, type EventFilterRule, type KeyRow } from "@/lib/event-match";

export const maxDuration = 60;

// AKEI 엑셀 행 타입
type AkeiRow = {
  title_kr_ge?: string;
  title_en_ge?: string;
  host_ge?: string;
  start_dt?: string;
  end_dt?: string;
  place_ge?: string;
  type_ge?: string;
  goods_ge?: string;
  logo_ge?: string;
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
    event_name:    name,
    event_name_en: String(row.title_en_ge ?? "").trim() || null,
    organizer:     String(row.host_ge ?? "").trim() || null,
    start_date:    start,
    end_date:      String(row.end_dt ?? "").trim() || null,
    venue:         place || null,
    venue_region:  extractVenueRegion(place) || null,
    category:      String(row.type_ge ?? "").trim() || null,
    industry:      String(row.goods_ge ?? "").trim().slice(0, 300) || null,
    website:       String(row.url_ge ?? "").trim() || null,
    image_url:     String(row.logo_ge ?? "").trim() || null,
    source:        "akei",
    is_published:  true,
  };
}

type Existing = {
  id: string; event_name: string; start_date: string; organizer: string | null; venue: string | null;
  category: string | null; website: string | null; end_date: string | null; venue_region: string | null;
  event_name_en: string | null; industry: string | null; image_url: string | null; source: string | null;
};

/**
 * POST /api/admin/import-exhibitions
 * body: { rows: AkeiRow[], dry_run: boolean }
 *
 * 자동 수집(scrape-events)이 막혔을 때를 위한 보조 수단 — 자동 수집과 같은 중복 판정·비공개 규칙을 사용
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

  // 현재 DB 행사 목록(비공개 포함) — 표기 차이를 흡수한 매칭용 인덱스
  const { data: existing } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, organizer, venue, category, website, end_date, venue_region, event_name_en, industry, image_url, source")
    .limit(10000);
  const idx: DateIndex<Existing & KeyRow> = new Map();
  for (const e of (existing ?? []) as Existing[]) addToIndex(idx, e);

  const { data: rules } = await supabase.from("event_keyword_filters").select("keyword, filter_type");

  const toInsert: NonNullable<ReturnType<typeof mapRow>>[] = [];
  const toMerge:  { id: string; name: string; date: string; patch: Record<string, string | null> }[] = [];
  const skipped:  string[] = [];
  const dropped:  { name: string; reason: string }[] = [];

  for (const raw of rows) {
    const mapped = mapRow(raw);
    if (!mapped) continue;

    // 기존에 비공개로 돌려온 분야·키워드는 신규 추가 단계에서 제외
    const reason = noiseReason(mapped.event_name, mapped.category, (rules ?? []) as EventFilterRule[]);
    const hit = matchEvent(idx, mapped.event_name, mapped.start_date);

    if (!hit) {
      if (reason) { dropped.push({ name: mapped.event_name, reason }); continue; }
      toInsert.push(mapped);
      addToIndex(idx, { ...mapped, id: "" } as Existing);   // 같은 파일 안의 중복 방지
    } else {
      // 빈 필드만 채우는 MERGE 패치 계산
      const patch: Record<string, string | null> = {};
      const fill = ["organizer", "venue", "venue_region", "category", "website", "end_date", "event_name_en", "industry", "image_url"] as const;
      for (const f of fill) if (!hit[f] && mapped[f]) patch[f] = mapped[f];
      if (!hit.source || hit.source === "manual") patch.source = "akei";

      if (Object.keys(patch).length > 0) toMerge.push({ id: hit.id, name: hit.event_name, date: hit.start_date, patch });
      else skipped.push(mapped.event_name);
    }
  }

  // 미리보기 모드 — DB 변경 없이 통계만 반환
  if (dry_run) {
    return NextResponse.json({
      new_count:     toInsert.length,
      merge_count:   toMerge.length,
      skip_count:    skipped.length,
      dropped_count: dropped.length,
      preview_new:   toInsert.slice(0, 5).map((r) => ({ name: r.event_name, date: r.start_date, venue: r.venue })),
      preview_merge: toMerge.slice(0, 5).map((m) => ({ name: m.name, date: m.date, fields: Object.keys(m.patch) })),
      preview_dropped: dropped.slice(0, 8),
    });
  }

  // 실제 실행
  let inserted = 0;
  let updated  = 0;
  const errors: string[] = [];

  // 신규 insert (배치 100건씩)
  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100);
    const { error } = await supabase.from("convention_events").insert(batch);
    if (error) errors.push(`insert batch ${i}: ${error.message}`);
    else inserted += batch.length;
  }

  // MERGE update (개별)
  for (const { id, patch } of toMerge) {
    const { error } = await supabase.from("convention_events").update(patch).eq("id", id);
    if (error) errors.push(`update ${id}: ${error.message}`);
    else updated++;
  }

  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    skipped: skipped.length,
    dropped: dropped.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
}
