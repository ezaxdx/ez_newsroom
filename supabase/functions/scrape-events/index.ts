/**
 * Supabase Edge Function: scrape-events
 * 쇼알라 + 한국전시주최자협회 행사 데이터 수집 → convention_events 저장
 *
 * Deno runtime (Wall-clock: 150s, CPU: 2s per invocation burst)
 * Authorization: Bearer {CRON_SECRET}
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET       = Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── 유틸 ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseDateRange(text: string): { start: string; end: string } | null {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*[~–]\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

function parseVenueInfo(location: string | null): { venue: string; venue_region: string | null } {
  if (!location) return { venue: "기타", venue_region: null };

  const KNOWN: { kw: string; venue: string; region: string }[] = [
    { kw: "코엑스",         venue: "코엑스",               region: "서울" },
    { kw: "COEX",           venue: "코엑스",               region: "서울" },
    { kw: "킨텍스",         venue: "킨텍스",               region: "경기" },
    { kw: "KINTEX",         venue: "킨텍스",               region: "경기" },
    { kw: "SETEC",          venue: "SETEC",                region: "서울" },
    { kw: "세텍",           venue: "SETEC",                region: "서울" },
    { kw: "aT센터",         venue: "aT센터",               region: "서울" },
    { kw: "AT센터",         venue: "aT센터",               region: "서울" },
    { kw: "벡스코",         venue: "벡스코",               region: "부산" },
    { kw: "BEXCO",          venue: "벡스코",               region: "부산" },
    { kw: "엑스코",         venue: "엑스코",               region: "대구" },
    { kw: "EXCO",           venue: "엑스코",               region: "대구" },
    { kw: "김대중컨벤션",   venue: "김대중컨벤션센터",     region: "광주" },
    { kw: "수원컨벤션",     venue: "수원컨벤션센터",       region: "경기" },
    { kw: "송도컨벤시아",   venue: "송도컨벤시아",         region: "인천" },
    { kw: "제주국제컨벤션", venue: "제주국제컨벤션센터",   region: "제주" },
    { kw: "ICC JEJU",       venue: "제주국제컨벤션센터",   region: "제주" },
    { kw: "창원컨벤션",     venue: "창원컨벤션센터",       region: "경남" },
    { kw: "경주화백",       venue: "경주화백컨벤션센터",   region: "경북" },
    { kw: "대전컨벤션",     venue: "대전컨벤션센터",       region: "대전" },
    { kw: "군산새만금",     venue: "군산새만금컨벤션센터", region: "전북" },
    { kw: "오스코",         venue: "청주 오스코",          region: "충북" },
  ];

  const loc = location.replace(/\([^)]+\)/g, "").trim();
  for (const { kw, venue, region } of KNOWN) {
    if (loc.includes(kw)) return { venue, venue_region: region };
  }

  const REGIONS = ["서울","부산","대구","인천","광주","대전","울산","세종",
                   "경기","강원","충북","충남","전북","전남","경북","경남","제주"];
  const regionMatch = REGIONS.find((r) => loc.startsWith(r) || loc.includes(r + " ")) ?? null;

  return { venue: loc.split(/\s+/).at(-1) || "기타", venue_region: regionMatch };
}

function cleanOrganizer(org: string | null): string | null {
  if (!org) return null;
  return org.replace(/\([^)]*\)/g, "").replace(/（[^）]*）/g, "").replace(/㈜/g, "").trim() || null;
}

// ── 쇼알라 ──────────────────────────────────────────────────────

async function scrapeShowala(): Promise<object[]> {
  console.log("쇼알라 스크래핑...");
  const res = await fetch("https://www.showala.com/ex/ex_list.php", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" },
  });
  if (!res.ok) throw new Error(`쇼알라 오류: ${res.status}`);

  const html  = await res.text();
  const today = new Date().toISOString().split("T")[0];
  const items = html.split('<li class="ex_item clearfix">').slice(1);
  const events: object[] = [];

  for (const item of items) {
    const nameM = item.match(/class="ex_tit_a[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const hrefM = item.match(/href="(\/ex\/ex_detail\.php\?idx=\d+)"/);
    if (!nameM || !hrefM) continue;

    const event_name = nameM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!event_name) continue;

    const enM         = item.match(/class="only_line ex_e_tit">([\s\S]*?)<\/p>/);
    const event_name_en = enM ? enM[1].replace(/<[^>]+>/g, "").trim() || null : null;

    const dateM    = item.match(/class="ex_date">([\s\S]*?)<\/div>/);
    const dateText = dateM ? dateM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    const dates    = parseDateRange(dateText);
    if (!dates || dates.end < today) continue;

    const placeM   = item.match(/class="ex_place[^"]*">([\s\S]*?)<\/div>/);
    const location = placeM ? placeM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null : null;
    const { venue, venue_region } = parseVenueInfo(location);

    const indM     = item.match(/class="only_line ex_buss_cate">([\s\S]*?)<\/div>/);
    const industry = indM ? indM[1].replace(/<[^>]+>/g, "").replace(/산업분야/g, "").replace(/\s+/g, " ").trim() || null : null;

    events.push({
      venue, venue_region, event_name, event_name_en,
      start_date: dates.start, end_date: dates.end,
      location, category: "전시", industry,
      organizer: null,
      website: `https://www.showala.com${hrefM[1]}`,
      is_published: true,
    });
  }

  console.log(`쇼알라: ${events.length}건`);
  return events;
}

// ── 한국전시주최자협회 ────────────────────────────────────────────

async function scrapeKeoa(): Promise<object[]> {
  console.log("KEOA 스크래핑...");
  const today    = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const seenIds  = new Set<string>();
  const events: object[] = [];

  // 현재월 포함 7개월치
  for (let i = 0; i < 7; i++) {
    const d     = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");

    console.log(`  KEOA ${year}-${month} 수집...`);
    const listRes = await fetch(
      `https://www.keoa.org/directory/schedule?cur_y=${year}&cur_m=${month}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" } }
    );
    if (!listRes.ok) { console.warn(`  ${year}-${month} 오류: ${listRes.status}`); continue; }

    const listHtml = await listRes.text();
    const allMatches = [...listHtml.matchAll(/data-value="(\d+)"/g)].map((m) => m[1]);
    const ids = [...new Set(allMatches)].filter((id) => !seenIds.has(id));
    console.log(`  ${year}-${month}: ${ids.length}개 ID`);

    for (const id of ids) {
      seenIds.add(id);
      await sleep(200);

      try {
        const detailRes = await fetch(
          `https://www.keoa.org/ajax/loadexpodetail?id=${id}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" } }
        );
        if (!detailRes.ok) continue;
        const detailHtml = await detailRes.text();

        const fields: Record<string, string> = {};
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
        if (!dates || dates.end < todayStr) continue;

        const enM           = rawName.match(/\(([A-Za-z0-9\s\-&\/\.']+)\)/);
        const event_name    = rawName.replace(/\s*\([^)]*\)\s*/g, "").trim();
        const event_name_en = enM ? enM[1].trim() : null;
        const { venue, venue_region } = parseVenueInfo(venueRaw);

        events.push({
          venue, venue_region, event_name, event_name_en,
          start_date: dates.start, end_date: dates.end,
          location: venueRaw || null, category: "전시",
          industry: fields["출품품목"] || null,
          organizer: cleanOrganizer(fields["주최/주관"] ?? null),
          website: `https://www.google.com/search?q=${encodeURIComponent(event_name)}`,
          is_published: true,
        });
      } catch (e) {
        console.warn(`  ID ${id} 실패:`, (e as Error).message);
      }
    }

    await sleep(400);
  }

  console.log(`KEOA: ${events.length}건`);
  return events;
}

// ── Supabase 저장 ─────────────────────────────────────────────────

async function upsertEvents(events: object[], source: string) {
  if (!events.length) { console.log(`${source}: 수집 없음`); return 0; }

  const names = (events as Array<{ event_name: string; start_date: string }>).map((e) => e.event_name);
  const { data: existing } = await supabase
    .from("convention_events")
    .select("event_name, start_date")
    .in("event_name", names);

  const existingKeys = new Set((existing ?? []).map((e) => `${e.event_name}|${e.start_date}`));
  const newEvents = (events as Array<{ event_name: string; start_date: string }>)
    .filter((e) => !existingKeys.has(`${e.event_name}|${e.start_date}`));

  console.log(`${source}: ${newEvents.length}건 신규 (${events.length - newEvents.length}건 중복 스킵)`);
  if (!newEvents.length) return 0;

  const BATCH = 50;
  for (let i = 0; i < newEvents.length; i += BATCH) {
    const { error } = await supabase.from("convention_events").insert(newEvents.slice(i, i + BATCH));
    if (error) console.error("삽입 오류:", error.message);
  }
  return newEvents.length;
}

// ── 메인 핸들러 ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // POST 전용
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 인증
  const auth = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const started = Date.now();
  console.log("scrape-events 시작");

  try {
    const [showalaEvents, keoaEvents] = await Promise.all([
      scrapeShowala(),
      scrapeKeoa(),
    ]);

    const [showalaNew, keoaNew] = await Promise.all([
      upsertEvents(showalaEvents, "쇼알라"),
      upsertEvents(keoaEvents, "KEOA"),
    ]);

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`완료: 쇼알라 ${showalaNew}건, KEOA ${keoaNew}건 신규 삽입 (${elapsed}s)`);

    return new Response(
      JSON.stringify({ ok: true, showala: showalaNew, keoa: keoaNew, elapsed }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("오류:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
