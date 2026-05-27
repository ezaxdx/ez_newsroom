/**
 * convention_events 중복/불량 데이터 정리
 * 실행: node scripts/dedup-events.js
 * 옵션: --dry-run  (삭제 없이 미리보기)
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = "https://pdnumzklfckhdepdpmwi.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkbnVtemtsZmNraGRlcGRwbXdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc0NzY0NCwiZXhwIjoyMDkyMzIzNjQ0fQ.0zAj5vt-zNbk7Ec0lWqUHVjPodlqgNa7OYKyU9VQxKQ";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DRY_RUN = process.argv.includes("--dry-run");

// 의미 없는 행사명 (삭제 대상)
const NOISE_NAMES = [
  "대관 행사", "대관행사", "대관", "행사 대관",
];

// 의심스러운 venue (해외/불명확) — 해당 venue는 is_published=false 처리
const FOREIGN_VENUE_KEYWORDS = [
  "Centre", "Center", "Kemayoran", "Singapore", "Bogotá", "Norte",
  "Versailles", "SECC", "V.E.C", "Online", "쾰른", "베트남",
];

async function main() {
  console.log("🔍 convention_events 정리 시작");
  if (DRY_RUN) console.log("   (dry-run 모드 — DB 변경 없음)\n");

  // 전체 데이터 로드
  const { data: all, error } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, end_date, venue, venue_region, organizer, website, industry, is_published")
    .order("created_at", { ascending: true });

  if (error) { console.error("로드 실패:", error.message); process.exit(1); }
  console.log(`총 ${all.length}건 로드\n`);

  const toDelete = new Set();

  // ── 1. 노이즈 행사명 삭제 ────────────────────────────────
  const noiseRows = all.filter(e => NOISE_NAMES.some(n => e.event_name?.trim() === n));
  console.log(`[1] 노이즈 행사명: ${noiseRows.length}건`);
  noiseRows.forEach(e => {
    console.log(`  삭제: [${e.start_date}] "${e.event_name}" @ ${e.venue}`);
    toDelete.add(e.id);
  });

  // ── 2. 중복 제거 (event_name + start_date 기준) ──────────
  const groups = new Map();
  for (const e of all) {
    if (toDelete.has(e.id)) continue;
    const key = `${e.event_name?.trim()}|${e.start_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  let dupCount = 0;
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue;

    // 정보량 점수: null이 아닌 필드 수 + website 있으면 +2
    const scored = rows.map(r => ({
      ...r,
      score: [r.organizer, r.website, r.industry, r.venue_region]
               .filter(Boolean).length + (r.website ? 2 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);

    // 점수 1위 남기고 나머지 삭제
    const keep    = scored[0];
    const discard = scored.slice(1);
    dupCount += discard.length;

    console.log(`\n[중복] "${keep.event_name}" (${keep.start_date}) — ${rows.length}건 → 1건 유지`);
    console.log(`  유지: id=${keep.id}, venue=${keep.venue}, score=${keep.score}`);
    discard.forEach(r => {
      console.log(`  삭제: id=${r.id}, venue=${r.venue}, score=${r.score}`);
      toDelete.add(r.id);
    });
  }
  console.log(`\n[2] 중복: ${dupCount}건 삭제 예정`);

  // ── 3. 해외/불명확 venue → is_published = false ──────────
  const foreignRows = all.filter(e =>
    !toDelete.has(e.id) &&
    e.is_published &&
    FOREIGN_VENUE_KEYWORDS.some(kw => e.venue?.includes(kw))
  );
  console.log(`\n[3] 해외/불명확 venue 비공개 처리: ${foreignRows.length}건`);
  foreignRows.forEach(e =>
    console.log(`  비공개: "${e.event_name}" @ ${e.venue}`)
  );

  if (DRY_RUN) {
    console.log(`\n📋 [DRY-RUN] 총 삭제 예정: ${toDelete.size}건, 비공개 처리: ${foreignRows.length}건`);
    return;
  }

  // ── 실제 삭제 ────────────────────────────────────────────
  const ids = [...toDelete];
  if (ids.length) {
    const BATCH = 100;
    for (let i = 0; i < ids.length; i += BATCH) {
      const { error } = await supabase
        .from("convention_events")
        .delete()
        .in("id", ids.slice(i, i + BATCH));
      if (error) console.error("삭제 오류:", error.message);
    }
    console.log(`\n✅ ${ids.length}건 삭제 완료`);
  }

  // ── 비공개 처리 ──────────────────────────────────────────
  if (foreignRows.length) {
    const { error } = await supabase
      .from("convention_events")
      .update({ is_published: false })
      .in("id", foreignRows.map(e => e.id));
    if (error) console.error("비공개 처리 오류:", error.message);
    else console.log(`✅ ${foreignRows.length}건 비공개 처리 완료`);
  }

  // ── 최종 현황 ────────────────────────────────────────────
  const { count } = await supabase
    .from("convention_events")
    .select("*", { count: "exact", head: true })
    .eq("is_published", true);
  console.log(`\n📊 정리 후 공개 행사: ${count}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
