import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

// 행사명 완전 일치 삭제
const NOISE_NAMES = ["대관 행사", "대관행사", "대관", "행사 대관"];

// 행사명에 포함되면 삭제 (키워드 포함 방식)
const NOISE_KEYWORDS = [
  "정기총회", "임시총회", "이사회", "간담회",
  "육아", "웨딩", "wedding",
  "설명회", "공청회", "청문회",
  "임용", "채용", "졸업식", "입학식",
];

// 해외 venue는 그대로 오픈 유지 — 비공개 처리 안 함

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
  is_published: boolean;
};

/**
 * GET /api/admin/dedup-events  → dry-run (미리보기)
 * POST /api/admin/dedup-events → 실제 실행
 */
async function runDedup(dryRun: boolean) {
  const supabase = createAdminClient();

  const { data: all, error } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, end_date, venue, venue_region, organizer, website, industry, is_published")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (all ?? []) as EventRow[];

  const toDelete = new Set<string>();

  // 1. 노이즈 행사명 삭제 (완전 일치 + 키워드 포함)
  const noiseRows = rows.filter((e) => {
    const name = e.event_name?.trim() ?? "";
    const nameLower = name.toLowerCase();
    return NOISE_NAMES.some((n) => name === n)
      || NOISE_KEYWORDS.some((kw) => nameLower.includes(kw.toLowerCase()));
  });
  noiseRows.forEach((e) => toDelete.add(e.id));

  // 2. 중복 제거 (event_name + start_date 기준)
  const groups = new Map<string, EventRow[]>();
  for (const e of rows) {
    if (toDelete.has(e.id)) continue;
    const key = `${e.event_name?.trim()}|${e.start_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const dupDetails: { keep: string; discard: string[] }[] = [];
  for (const [, groupRows] of groups) {
    if (groupRows.length <= 1) continue;
    const scored = groupRows.map((r) => ({
      ...r,
      score:
        [r.organizer, r.website, r.industry, r.venue_region].filter(Boolean).length +
        (r.website ? 2 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const keep    = scored[0];
    const discard = scored.slice(1);
    discard.forEach((r) => toDelete.add(r.id));
    dupDetails.push({ keep: keep.event_name, discard: discard.map((r) => r.id) });
  }

  if (!dryRun) {
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
    noise:   noiseRows.length,
    dup:     toDelete.size - noiseRows.length,
    foreign: 0,
    total_delete: toDelete.size,
    dry_run: dryRun,
    dup_groups: dupDetails.length,
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
  const dryRun = body.dry_run === true;

  try {
    const result = await runDedup(dryRun);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
