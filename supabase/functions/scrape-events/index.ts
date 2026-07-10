/**
 * Supabase Edge Function: scrape-events
 * 쇼알라 + 한국전시주최자협회 행사 수집 → convention_events 저장
 *
 * Deno runtime (Wall-clock: 150s)
 * Authorization: Bearer {CRON_SECRET}
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET      = Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── 타입 ──────────────────────────────────────────────────────────

type ScrapedEvent = {
  venue: string;
  venue_region: string | null;
  event_name: string;
  event_name_en: string | null;
  start_date: string;
  end_date: string;
  location: string | null;
  category: string;
  industry: string | null;
  organizer: string | null;
  image_url: string | null;
  website: string | null;
  is_published: boolean;
  source: string;
};

// ── 노이즈 필터 ────────────────────────────────────────────────────
// 스크래핑 단계에서 아예 저장 안 함 (전시분야·행사명 기준)

const NOISE_INDUSTRIES = [
  "패션", "뷰티", "웨딩", "육아", "반려동물",
  "가정용품", "식품", "농업", "귀농", "주얼리", "성인", "종교",
];

const NOISE_NAME_EXACT = new Set(["대관 행사", "대관행사", "대관", "행사 대관"]);

const NOISE_NAME_KEYWORDS = [
  "정기총회", "임시총회", "이사회", "간담회",
  "육아", "웨딩", "wedding", "설명회", "공청회",
  "채용", "졸업식", "입학식",
];

function isNoise(name: string, industry: string | null): boolean {
  const lname = name.toLowerCase();
  if (NOISE_NAME_EXACT.has(name)) return true;
  if (NOISE_NAME_KEYWORDS.some((kw) => lname.includes(kw.toLowerCase()))) return true;
  if (industry && NOISE_INDUSTRIES.some((n) => industry.includes(n))) return true;
  return false;
}

// ── 유틸 ──────────────────────────────────────────────────────────

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
  return org
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/㈜/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

// KEOA 주최/주관 필드 → 주최기관만 추출 (주관사 PCO 제거)
function parseKeoaOrganizer(raw: string | null): string | null {
  if (!raw) return null;

  // "주최: X 주관: Y" 패턴
  const juchoiM = raw.match(/주최\s*[:：]\s*([^주관]+)/);
  if (juchoiM) return cleanOrganizer(juchoiM[1].trim());

  // "X / Y" 패턴 — 슬래시 앞이 주최, 뒤가 주관사(PCO)
  if (raw.includes("/")) return cleanOrganizer(raw.split("/")[0].trim());

  return cleanOrganizer(raw);
}

// ── 쇼알라 상세페이지 ────────────────────────────────────────────

async function fetchShowalaDetail(idx: string): Promise<{
  organizer: string | null;
  website: string | null;
  display_industry: string | null;
}> {
  await sleep(150);
  try {
    const res = await fetch(`https://www.showala.com/ex/ex_detail.php?idx=${idx}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" },
    });
    if (!res.ok) return { organizer: null, website: null, display_industry: null };
    const html = await res.text();

    // th/td 쌍 파싱
    const fields: Record<string, string> = {};
    const fieldRaw: Record<string, string> = {};
    for (const [, rowHtml] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const thM = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/);
      const tdM = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/);
      if (thM && tdM) {
        const k = thM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        const v = tdM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (k) {
          fields[k] = v;
          fieldRaw[k] = tdM[1];
        }
      }
    }

    const organizer = cleanOrganizer(fields["주최"] ?? fields["주최기관"] ?? null);

    // 홈페이지 URL: td 원본 HTML에서 href 추출
    const homeRaw = fieldRaw["홈페이지"] ?? fieldRaw["웹사이트"] ?? "";
    const hrefM   = homeRaw.match(/href="([^"]+)"/);
    const website = hrefM?.[1]?.startsWith("http") ? hrefM[1] : null;

    const display_industry = fields["전시분야"] ?? fields["산업분야"] ?? null;

    return { organizer, website, display_industry };
  } catch {
    return { organizer: null, website: null, display_industry: null };
  }
}

// ── 쇼알라 ──────────────────────────────────────────────────────

async function scrapeShowala(): Promise<ScrapedEvent[]> {
  console.log("쇼알라 스크래핑...");
  const res = await fetch("https://www.showala.com/ex/ex_list.php", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" },
  });
  if (!res.ok) throw new Error(`쇼알라 오류: ${res.status}`);

  const html  = await res.text();
  const today = new Date().toISOString().split("T")[0];
  const items = html.split('<li class="ex_item clearfix">').slice(1);
  const events: ScrapedEvent[] = [];
  let noiseCount = 0;

  for (const item of items) {
    const nameM = item.match(/class="ex_tit_a[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const hrefM = item.match(/href="(\/ex\/ex_detail\.php\?idx=(\d+))"/);
    if (!nameM || !hrefM) continue;

    const event_name = nameM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!event_name) continue;

    const enM           = item.match(/class="only_line ex_e_tit">([\s\S]*?)<\/p>/);
    const event_name_en = enM ? enM[1].replace(/<[^>]+>/g, "").trim() || null : null;

    const dateM    = item.match(/class="ex_date">([\s\S]*?)<\/div>/);
    const dateText = dateM ? dateM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    const dates    = parseDateRange(dateText);
    if (!dates || dates.end < today) continue;

    const placeM   = item.match(/class="ex_place[^"]*">([\s\S]*?)<\/div>/);
    const location = placeM ? placeM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null : null;
    const { venue, venue_region } = parseVenueInfo(location);

    const indM     = item.match(/class="only_line ex_buss_cate">([\s\S]*?)<\/div>/);
    const listIndustry = indM
      ? indM[1].replace(/<[^>]+>/g, "").replace(/산업분야/g, "").replace(/\s+/g, " ").trim() || null
      : null;

    const imgM      = item.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const image_url = imgM
      ? (imgM[1].startsWith("http") ? imgM[1] : `https://www.showala.com${imgM[1]}`)
      : null;

    const idx = hrefM[2];

    // 상세페이지 fetch — 주최기관 + 홈페이지 + 전시분야 확보
    const detail = await fetchShowalaDetail(idx);

    const resolvedIndustry = detail.display_industry ?? listIndustry;

    // 노이즈 필터: 스크래핑 단계에서 제거
    if (isNoise(event_name, resolvedIndustry)) {
      noiseCount++;
      continue;
    }

    events.push({
      venue, venue_region, event_name, event_name_en,
      start_date: dates.start, end_date: dates.end,
      location, category: "전시",
      industry: resolvedIndustry,
      organizer: detail.organizer,
      image_url,
      // 홈페이지 URL 있으면 우선, 없으면 쇼알라 상세 URL 유지
      website: detail.website ?? `https://www.showala.com${hrefM[1]}`,
      is_published: true,
      source: "showala",
    });
  }

  console.log(`쇼알라: ${events.length}건 수집, ${noiseCount}건 노이즈 제거`);
  return events;
}

// ── 한국전시주최자협회 ────────────────────────────────────────────

async function scrapeKeoa(): Promise<ScrapedEvent[]> {
  console.log("KEOA 스크래핑...");
  const today    = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const seenIds  = new Set<string>();
  const events: ScrapedEvent[] = [];
  let noiseCount = 0;

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

        // 주최/주관에서 주최기관만 추출 (주관사 PCO 분리)
        const organizer = parseKeoaOrganizer(fields["주최/주관"] ?? null);

        if (isNoise(event_name, null)) {
          noiseCount++;
          continue;
        }

        const keImgM = detailHtml.match(
          /<img[^>]+src="([^"]+)"[^>]*class="[^"]*poster[^"]*"|<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/i
        ) ?? detailHtml.match(/<img[^>]+src="(\/uploads\/[^"]+\.(jpg|jpeg|png|webp))"[^>]*>/i);
        const keImageRaw = keImgM ? (keImgM[1] || keImgM[2]) : null;
        const image_url  = keImageRaw
          ? (keImageRaw.startsWith("http") ? keImageRaw : `https://www.keoa.org${keImageRaw}`)
          : null;

        events.push({
          venue, venue_region, event_name, event_name_en,
          start_date: dates.start, end_date: dates.end,
          location: venueRaw || null, category: "전시",
          industry: fields["출품품목"] || null,
          organizer,
          image_url,
          website: null, // KEOA에는 실제 홈페이지 URL 없음
          is_published: true,
          source: "keoa",
        });
      } catch (e) {
        console.warn(`  ID ${id} 실패:`, (e as Error).message);
      }
    }

    await sleep(400);
  }

  console.log(`KEOA: ${events.length}건 수집, ${noiseCount}건 노이즈 제거`);
  return events;
}

// ── 크로스소스 병합 ────────────────────────────────────────────────
// 쇼알라(이미지·홈페이지·전시분야) + KEOA(주최기관) 같은 행사면 합침

function crossSourceMerge(showala: ScrapedEvent[], keoa: ScrapedEvent[]): ScrapedEvent[] {
  const merged = new Map<string, ScrapedEvent>();

  for (const e of showala) {
    merged.set(`${e.event_name}|${e.start_date}`, { ...e });
  }

  for (const e of keoa) {
    const key = `${e.event_name}|${e.start_date}`;
    if (merged.has(key)) {
      const s = merged.get(key)!;
      merged.set(key, {
        ...s,
        source:        "merged",
        organizer:     s.organizer     ?? e.organizer,
        industry:      s.industry      ?? e.industry,
        image_url:     s.image_url     ?? e.image_url,
        event_name_en: s.event_name_en ?? e.event_name_en,
      });
    } else {
      merged.set(key, { ...e });
    }
  }

  return [...merged.values()];
}

// ── DB upsert (null 필드 채우기 방식) ─────────────────────────────

const GOOGLE_SEARCH_PREFIX = "https://www.google.com/search";

async function upsertMergeEvents(events: ScrapedEvent[]): Promise<{ inserted: number; updated: number }> {
  if (!events.length) return { inserted: 0, updated: 0 };

  const names = events.map((e) => e.event_name);
  const { data: existing } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, organizer, website, image_url, industry, event_name_en, source")
    .in("event_name", names);

  type ExRow = { id: string; event_name: string; start_date: string; organizer: string | null; website: string | null; image_url: string | null; industry: string | null; event_name_en: string | null; source: string | null };
  const existingMap = new Map<string, ExRow>(
    (existing ?? []).map((e) => [`${e.event_name}|${e.start_date}`, e as ExRow])
  );

  const toInsert: ScrapedEvent[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

  for (const event of events) {
    const key = `${event.event_name}|${event.start_date}`;
    const ex  = existingMap.get(key);

    if (!ex) {
      toInsert.push(event);
    } else {
      const updates: Record<string, unknown> = {};
      if (!ex.organizer && event.organizer) updates.organizer = event.organizer;
      if (!ex.image_url && event.image_url) updates.image_url = event.image_url;
      if (!ex.industry && event.industry) updates.industry = event.industry;
      if (!ex.event_name_en && event.event_name_en) updates.event_name_en = event.event_name_en;
      // 구글 검색 URL이거나 null이면 실제 URL로 교체
      if (event.website && (!ex.website || ex.website.startsWith(GOOGLE_SEARCH_PREFIX))) {
        updates.website = event.website;
      }
      if (event.source === "merged" && ex.source !== "merged") updates.source = "merged";

      if (Object.keys(updates).length > 0) toUpdate.push({ id: ex.id, fields: updates });
    }
  }

  if (toInsert.length > 0) {
    const BATCH = 50;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const { error } = await supabase.from("convention_events").insert(toInsert.slice(i, i + BATCH));
      if (error) console.error("삽입 오류:", error.message);
    }
  }

  for (const { id, fields } of toUpdate) {
    const { error } = await supabase.from("convention_events").update(fields).eq("id", id);
    if (error) console.error(`update ${id} 오류:`, error.message);
  }

  console.log(`신규 ${toInsert.length}건, 기존 보강 ${toUpdate.length}건`);
  return { inserted: toInsert.length, updated: toUpdate.length };
}

// ── 키워드 필터 자동 비공개 ──────────────────────────────────────────

async function applyKeywordFilters(): Promise<number> {
  const { data: filters } = await supabase.from("event_keyword_filters").select("keyword");
  if (!filters?.length) return 0;

  let autoHidden = 0;
  for (const { keyword } of filters) {
    const { count } = await supabase
      .from("convention_events")
      .update({ is_published: false })
      .ilike("event_name", `%${keyword}%`)
      .eq("is_published", true)
      .select("*", { count: "exact", head: true });
    autoHidden += count ?? 0;
  }
  console.log(`키워드 필터: ${autoHidden}건 자동 비공개`);
  return autoHidden;
}

// ── 메인 핸들러 ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const auth       = req.headers.get("authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const validAuth  = !CRON_SECRET
    || auth === `Bearer ${CRON_SECRET}`
    || cronHeader === CRON_SECRET
    || auth === `Bearer ${SERVICE_ROLE_KEY}`;
  if (!validAuth) return new Response("Unauthorized", { status: 401 });

  const started = Date.now();
  console.log("scrape-events 시작");

  try {
    // 쇼알라 + KEOA 병렬 수집
    const [showalaEvents, keoaEvents] = await Promise.all([
      scrapeShowala(),
      scrapeKeoa(),
    ]);

    // 크로스소스 병합 (같은 행사명+날짜면 best fields 합침)
    const mergedEvents = crossSourceMerge(showalaEvents, keoaEvents);
    console.log(`병합 후 총: ${mergedEvents.length}건`);

    // DB upsert — 신규 insert + 기존 null 필드 보강
    const { inserted, updated } = await upsertMergeEvents(mergedEvents);

    // 키워드 필터 자동 비공개 (DB에 저장된 키워드 기준)
    const autoHidden = await applyKeywordFilters();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`완료 (${elapsed}s): 신규 ${inserted}건, 보강 ${updated}건, 비공개 ${autoHidden}건`);

    return new Response(
      JSON.stringify({ ok: true, inserted, updated, autoHidden, elapsed }),
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
