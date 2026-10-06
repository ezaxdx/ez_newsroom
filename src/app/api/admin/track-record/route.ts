import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { orgKey } from "@/lib/event-score";
import { clearScoringContextCache } from "@/lib/event-score-context";

// 수행실적 엑셀 → 행사 점수용 발주처 목록 (행사로 가져오지 않음, 공개하지 않음)
// 분기마다 최신 엑셀을 올리면 발주처·주최·주관 기관만 뽑아 event_org_affinity(tier=client)를 통째로 갱신한다.
// 테이블: supabase/revamp/08_event_scoring.sql

type Sheet = unknown[][];

// 헤더 행에서 열 위치를 이름으로 찾음 — 양식이 약간 바뀌어도(열 추가 등) 동작하도록
function findColumns(rows: Sheet) {
  const headerRows = rows.slice(0, 4).map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, "")));
  const find = (...names: string[]) => {
    for (const hr of headerRows) { const i = hr.findIndex((c) => names.some((n) => c === n || c.startsWith(n))); if (i >= 0) return i; }
    return -1;
  };
  return {
    name: find("프로젝트명"), year: find("연도"), evCat: find("행사분류"),
    client: find("발주처"), host: find("주최기관"), org: find("주관기관"),
  };
}

// 행사가 아닌 수행 건(놀이터 공간사업·플랫폼 구축·연구/유치 용역)은 점수 신호에서 제외
const isEventRow = (name: string, evCat: string) =>
  !/공간사업|스마트관광|연구용역|유치용역/.test(evCat) && !/플랫폼|KIDS|놀이터|직접판매/.test(name);

type Agg = { name: string; hit: number; lastYear: number | null; names: Map<string, number> };

function aggregate(rows: Sheet) {
  const col = findColumns(rows);
  if (col.name < 0) throw new Error("'프로젝트명' 열을 찾지 못했습니다. 수행실적 양식인지 확인하세요.");
  const orgs = new Map<string, Agg>();
  let total = 0, events = 0;
  for (const r of rows) {
    const name = String(r[col.name] ?? "").trim();
    const no = r[0];
    if (!name || no === "" || no == null || isNaN(Number(no))) continue;   // 헤더·빈 행 제외 (NO 열이 숫자인 데이터 행만)
    total++;
    const evCat = col.evCat >= 0 ? String(r[col.evCat] ?? "") : "";
    if (!isEventRow(name, evCat)) continue;
    events++;
    const year = col.year >= 0 ? Number(r[col.year]) || null : null;
    const weight = year && year >= 2024 ? 1 : 0.6;   // 최근 수행일수록 가중
    // 같은 행 안에서 같은 기관이 발주처·주최·주관에 중복되어도 한 번만 셈
    const seen = new Set<string>();
    for (const c of [col.client, col.host, col.org]) {
      if (c < 0) continue;
      for (const raw of String(r[c] ?? "").split(/[,\/、]/)) {
        const display = raw.replace(/\s+/g, " ").trim();
        const key = orgKey(display);
        if (key.length < 2 || display === "-" || key === "개인" || seen.has(key)) continue;
        seen.add(key);
        const a = orgs.get(key) ?? { name: display, hit: 0, lastYear: null, names: new Map() };
        a.hit += weight;
        if (year && (!a.lastYear || year > a.lastYear)) a.lastYear = year;
        a.names.set(display, (a.names.get(display) ?? 0) + 1);
        orgs.set(key, a);
      }
    }
  }
  for (const a of orgs.values()) a.name = [...a.names.entries()].sort((x, y) => y[1] - x[1])[0][0];   // 가장 자주 쓰인 표기를 대표 이름으로
  return { total, events, orgs };
}

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;
  const supabase = createAdminClient();
  const { data: meta, error } = await supabase.from("event_scoring_settings").select("track_record_at, track_record_file, track_record_rows").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ unavailable: true, error: error.message });
  const { count } = await supabase.from("event_org_affinity").select("id", { count: "exact", head: true }).eq("tier", "client");
  return NextResponse.json({ meta, client_count: count ?? 0 });
}

/**
 * POST { rows: 엑셀 시트(2차원 배열), file_name, dry_run }
 *  dry_run=true → 미리보기만 (DB 변경 없음)
 */
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { rows, file_name, dry_run } = (await req.json()) as { rows?: Sheet; file_name?: string; dry_run?: boolean };
  if (!Array.isArray(rows) || rows.length < 5) return NextResponse.json({ error: "엑셀 내용을 읽지 못했습니다" }, { status: 400 });

  let agg: ReturnType<typeof aggregate>;
  try { agg = aggregate(rows); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const supabase = createAdminClient();
  const { data: current, error: curErr } = await supabase.from("event_org_affinity").select("org_key").eq("tier", "client");
  if (curErr) return NextResponse.json({ error: `08_event_scoring.sql 을 먼저 실행하세요 (${curErr.message})` }, { status: 500 });
  const before = new Set((current ?? []).map((r: { org_key: string }) => r.org_key));
  const list = [...agg.orgs.entries()].map(([key, a]) => ({ key, ...a })).sort((a, b) => b.hit - a.hit);
  const added = list.filter((o) => !before.has(o.key));
  const removed = [...before].filter((k) => !agg.orgs.has(k));

  if (dry_run) {
    return NextResponse.json({
      total_rows: agg.total, event_rows: agg.events, org_count: list.length,
      added_count: added.length, removed_count: removed.length,
      top: list.slice(0, 10).map((o) => `${o.name}(${Math.round(o.hit * 10) / 10})`),
      added_sample: added.slice(0, 8).map((o) => o.name),
    });
  }

  // 반영 — 수행실적에서 온 발주처 목록을 통째로 교체 (수동으로 추가한 동종 업계·장소 운영사·PEO 목록은 건드리지 않음)
  const { error: delErr } = await supabase.from("event_org_affinity").delete().eq("tier", "client").eq("source", "track_record");
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200).map((o) => ({
      org_key: o.key, org_name: o.name, tier: "client", source: "track_record",
      hit_count: Math.max(1, Math.round(o.hit)), last_year: o.lastYear,
    }));
    const { error } = await supabase.from("event_org_affinity").upsert(batch, { onConflict: "org_key,tier" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabase.from("event_scoring_settings").update({
    track_record_at: new Date().toISOString(), track_record_file: file_name ?? null, track_record_rows: agg.events, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  clearScoringContextCache();

  return NextResponse.json({ ok: true, org_count: list.length, event_rows: agg.events, added_count: added.length, removed_count: removed.length });
}
