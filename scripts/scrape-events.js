/**
 * 행사 스크래핑 & Supabase 임포트
 * 대상: 쇼알라(showala.com), 한국전시주최자협회(keoa.org)
 *
 * 실행: node scripts/scrape-events.js
 * 옵션: node scripts/scrape-events.js --source=showala
 *       node scripts/scrape-events.js --source=keoa
 *       node scripts/scrape-events.js --dry-run   (DB 저장 없이 미리보기)
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = "https://pdnumzklfckhdepdpmwi.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkbnVtemtsZmNraGRlcGRwbXdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc0NzY0NCwiZXhwIjoyMDkyMzIzNjQ0fQ.0zAj5vt-zNbk7Ec0lWqUHVjPodlqgNa7OYKyU9VQxKQ";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const args    = process.argv.slice(2);
const SOURCE  = args.find(a => a.startsWith("--source="))?.split("=")[1] ?? "all";
const DRY_RUN = args.includes("--dry-run");

// ── 유틸 ─────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** "2026-04-17 ~ 2026-05-31" → { start, end } */
function parseDateRange(text) {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*[~–]\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

/** 장소 문자열에서 venue + venue_region 추출 */
function parseVenueInfo(location) {
  if (!location) return { venue: "기타", venue_region: null };

  // 알려진 컨벤션/전시장 키워드 매핑
  const KNOWN = [
    { kw: "코엑스",          venue: "코엑스",              region: "서울" },
    { kw: "COEX",            venue: "코엑스",              region: "서울" },
    { kw: "킨텍스",          venue: "킨텍스",              region: "경기" },
    { kw: "KINTEX",          venue: "킨텍스",              region: "경기" },
    { kw: "SETEC",           venue: "SETEC",               region: "서울" },
    { kw: "세텍",            venue: "SETEC",               region: "서울" },
    { kw: "aT센터",          venue: "aT센터",              region: "서울" },
    { kw: "AT센터",          venue: "aT센터",              region: "서울" },
    { kw: "벡스코",          venue: "벡스코",              region: "부산" },
    { kw: "BEXCO",           venue: "벡스코",              region: "부산" },
    { kw: "엑스코",          venue: "엑스코",              region: "대구" },
    { kw: "EXCO",            venue: "엑스코",              region: "대구" },
    { kw: "김대중컨벤션",    venue: "김대중컨벤션센터",    region: "광주" },
    { kw: "수원컨벤션",      venue: "수원컨벤션센터",      region: "경기" },
    { kw: "송도컨벤시아",    venue: "송도컨벤시아",        region: "인천" },
    { kw: "제주국제컨벤션",  venue: "제주국제컨벤션센터",  region: "제주" },
    { kw: "ICC JEJU",        venue: "제주국제컨벤션센터",  region: "제주" },
    { kw: "창원컨벤션",      venue: "창원컨벤션센터",      region: "경남" },
    { kw: "경주화백",        venue: "경주화백컨벤션센터",  region: "경북" },
    { kw: "대전컨벤션",      venue: "대전컨벤션센터",      region: "대전" },
    { kw: "군산새만금",      venue: "군산새만금컨벤션센터",region: "전북" },
    { kw: "청주오스코",      venue: "청주 오스코",         region: "충북" },
    { kw: "오스코",          venue: "청주 오스코",         region: "충북" },
  ];

  const loc = location.replace(/\([^)]+\)/g, "").trim();
  for (const { kw, venue, region } of KNOWN) {
    if (loc.includes(kw)) return { venue, venue_region: region };
  }

  // 시/도 추출
  const REGIONS = ["서울","부산","대구","인천","광주","대전","울산","세종",
                   "경기","강원","충북","충남","전북","전남","경북","경남","제주"];
  const regionMatch = REGIONS.find(r => loc.startsWith(r) || loc.includes(r + " "));

  return { venue: loc.split(/\s+/).slice(-1)[0] || "기타", venue_region: regionMatch ?? null };
}

/** (주), ㈜ 등 법인 표기 정제 */
function cleanOrganizer(org) {
  if (!org) return null;
  return org.replace(/\([^)]*\)/g, "").replace(/（[^）]*）/g, "").replace(/㈜/g, "").trim() || null;
}

// ── 쇼알라 스크래핑 ──────────────────────────────────────────
async function scrapeShowala() {
  console.log("\n🔍 쇼알라 스크래핑 중...");

  const res = await fetch("https://www.showala.com/ex/ex_list.php", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0; +https://github.com/ezaxdx)" },
  });
  if (!res.ok) throw new Error(`쇼알라 응답 오류: ${res.status}`);

  const html  = await res.text();
  const today = new Date().toISOString().split("T")[0];
  const items = html.split('<li class="ex_item clearfix">').slice(1);
  const events = [];

  for (const item of items) {
    // 행사명 + 상세 링크
    const nameM = item.match(/class="ex_tit_a[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const hrefM = item.match(/href="(\/ex\/ex_detail\.php\?idx=\d+)"/);
    if (!nameM || !hrefM) continue;

    const event_name = nameM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!event_name) continue;

    // 영문명
    const enM   = item.match(/class="only_line ex_e_tit">([\s\S]*?)<\/p>/);
    const event_name_en = enM ? enM[1].replace(/<[^>]+>/g, "").trim() || null : null;

    // 전시기간
    const dateM = item.match(/class="ex_date">([\s\S]*?)<\/div>/);
    const dateText = dateM ? dateM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    const dates = parseDateRange(dateText);
    if (!dates) continue;
    if (dates.end < today) continue;   // 종료된 행사 제외

    // 장소
    const placeM  = item.match(/class="ex_place[^"]*">([\s\S]*?)<\/div>/);
    const location = placeM ? placeM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null : null;
    const { venue, venue_region } = parseVenueInfo(location);

    // 산업분야
    const indM   = item.match(/class="only_line ex_buss_cate">([\s\S]*?)<\/div>/);
    const industry = indM
      ? indM[1].replace(/<[^>]+>/g, "").replace(/산업분야/g, "").replace(/\s+/g, " ").trim() || null
      : null;

    events.push({
      venue,
      venue_region,
      event_name,
      event_name_en,
      start_date: dates.start,
      end_date:   dates.end,
      location,
      category:   "전시",
      industry,
      organizer:  null,
      website:    `https://www.showala.com${hrefM[1]}`,
      is_published: true,
    });
  }

  console.log(`  → ${events.length}건 수집 (종료 행사 제외)`);
  return events;
}

// ── 한국전시주최자협회(KEOA) 스크래핑 ───────────────────────
async function scrapeKeoa() {
  console.log("\n🔍 한국전시주최자협회 스크래핑 중...");

  const today    = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const seenIds  = new Set();
  const events   = [];

  // 현재월 포함 7개월치
  for (let i = 0; i < 7; i++) {
    const d     = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");

    console.log(`  ${year}-${month} 목록 수집...`);

    const listRes = await fetch(
      `https://www.keoa.org/directory/schedule?cur_y=${year}&cur_m=${month}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" } }
    );
    if (!listRes.ok) { console.warn(`  ${year}-${month} 응답 오류: ${listRes.status}`); continue; }

    const listHtml = await listRes.text();
    const ids = [...new Set(
      [...listHtml.matchAll(/data-value="(\d+)"/g)].map(m => m[1])
    )].filter(id => !seenIds.has(id));

    console.log(`    ${ids.length}개 행사 ID 발견`);

    for (const id of ids) {
      seenIds.add(id);
      await sleep(250);   // 서버 부하 최소화

      try {
        const detailRes = await fetch(
          `https://www.keoa.org/ajax/loadexpodetail?id=${id}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" } }
        );
        if (!detailRes.ok) continue;
        const detailHtml = await detailRes.text();

        // <th>키</th><td>값</td> 쌍 추출
        const fields = {};
        for (const [, rowHtml] of detailHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
          const thM = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/);
          const tdM = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/);
          if (thM && tdM) {
            const k = thM[1].replace(/<[^>]+>/g, "").trim();
            const v = tdM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
            fields[k] = v;
          }
        }

        const rawName  = fields["전시회명"];
        const dateStr  = fields["개최일자"];
        const venueRaw = fields["개최장소"] || "";

        if (!rawName || !dateStr) continue;

        const dates = parseDateRange(dateStr);
        if (!dates) continue;
        if (dates.end < todayStr) continue;

        // 행사명 한글 / 영문 분리
        const enM        = rawName.match(/\(([A-Za-z0-9\s\-&\/\.']+)\)/);
        const event_name    = rawName.replace(/\s*\([^)]*\)\s*/g, "").trim();
        const event_name_en = enM ? enM[1].trim() : null;

        const { venue, venue_region } = parseVenueInfo(venueRaw);

        events.push({
          venue,
          venue_region,
          event_name,
          event_name_en,
          start_date: dates.start,
          end_date:   dates.end,
          location:   venueRaw || null,
          category:   "전시",
          industry:   fields["출품품목"] || null,
          organizer:  cleanOrganizer(fields["주최/주관"]),
          website:    `https://www.keoa.org/directory/schedule`,
          is_published: true,
        });

      } catch (e) {
        console.warn(`  ID ${id} 상세 로드 실패:`, e.message);
      }
    }

    await sleep(600);
  }

  console.log(`  → ${events.length}건 수집`);
  return events;
}

// ── Supabase 삽입 (중복 스킵) ─────────────────────────────────
async function upsertEvents(events, source) {
  if (!events.length) { console.log(`\n⚠️  ${source}: 수집 데이터 없음`); return; }

  if (DRY_RUN) {
    console.log(`\n📋 [DRY-RUN] ${source}: ${events.length}건 미리보기`);
    events.slice(0, 5).forEach(e =>
      console.log(`  [${e.start_date}~${e.end_date}] ${e.event_name} @ ${e.venue}`)
    );
    if (events.length > 5) console.log(`  ... 외 ${events.length - 5}건`);
    return;
  }

  // event_name + start_date 기준 중복 확인
  const { data: existing } = await supabase
    .from("convention_events")
    .select("event_name, start_date")
    .in("event_name", events.map(e => e.event_name));

  const existingKeys = new Set(
    (existing || []).map(e => `${e.event_name}|${e.start_date}`)
  );

  const newEvents = events.filter(
    e => !existingKeys.has(`${e.event_name}|${e.start_date}`)
  );

  console.log(`\n📤 ${source}: ${newEvents.length}건 신규 삽입 (${events.length - newEvents.length}건 중복 스킵)`);
  if (!newEvents.length) return;

  const BATCH = 50;
  for (let i = 0; i < newEvents.length; i += BATCH) {
    const { error } = await supabase
      .from("convention_events")
      .insert(newEvents.slice(i, i + BATCH));
    if (error) console.error("  삽입 오류:", error.message);
  }
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  console.log("🚀 행사 스크래핑 시작");
  if (DRY_RUN) console.log("   (dry-run 모드 — DB 저장 안 함)");

  if (SOURCE === "showala" || SOURCE === "all") {
    const events = await scrapeShowala();
    await upsertEvents(events, "쇼알라");
  }

  if (SOURCE === "keoa" || SOURCE === "all") {
    const events = await scrapeKeoa();
    await upsertEvents(events, "한국전시주최자협회");
  }

  console.log("\n✅ 완료!");
}

main().catch(e => { console.error("오류:", e); process.exit(1); });
