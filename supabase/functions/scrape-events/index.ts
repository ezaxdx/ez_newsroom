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
// 키워드는 DB event_keyword_filters에서 로드 (어드민에서 관리, 배포 불필요)
// filter_type: 'name' = 행사명 포함 매칭, 'industry' = 전시분야 포함 매칭

const NOISE_NAME_EXACT = new Set(["대관 행사", "대관행사", "대관", "행사 대관"]);

type NoiseFilters = { nameKw: string[]; industryKw: string[] };

async function loadNoiseFilters(): Promise<NoiseFilters> {
  const { data } = await supabase.from("event_keyword_filters").select("keyword, filter_type");
  const rows = (data ?? []) as { keyword: string; filter_type: string | null }[];
  return {
    nameKw:     rows.filter((r) => (r.filter_type ?? "name") === "name").map((r) => r.keyword),
    industryKw: rows.filter((r) => r.filter_type === "industry").map((r) => r.keyword),
  };
}

function isNoise(name: string, industry: string | null, f: NoiseFilters): boolean {
  const lname = name.toLowerCase();
  if (NOISE_NAME_EXACT.has(name)) return true;
  if (f.nameKw.some((kw) => lname.includes(kw.toLowerCase()))) return true;
  if (industry && f.industryKw.some((kw) => industry.includes(kw))) return true;
  return false;
}

// ── 유틸 ──────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 매칭 키 정규화: 소문자화 + 공백·특수문자 제거 ("서울 모터쇼" = "서울모터쇼")
function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[\s·,&\-–—]/g, "");
}

// 행사명 기반 카테고리 분류 (기본: 전시)
function classifyCategory(name: string): string {
  if (/컨퍼런스|콘퍼런스|포럼|세미나|심포지엄|학술대회|학회|컨그레스|콩그레스/i.test(name)) return "컨퍼런스";
  return "전시";
}

function parseDateRange(text: string): { start: string; end: string } | null {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*[~–]\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

function parseVenueInfo(location: string | null): { venue: string; venue_region: string | null } {
  if (!location) return { venue: "기타", venue_region: null };

  const KNOWN: { kw: string; venue: string; region: string }[] = [
    { kw: "코엑스",           venue: "코엑스",               region: "서울" },
    { kw: "COEX",             venue: "코엑스",               region: "서울" },
    { kw: "킨텍스",           venue: "킨텍스",               region: "경기" },
    { kw: "KINTEX",           venue: "킨텍스",               region: "경기" },
    { kw: "SETEC",            venue: "SETEC",                region: "서울" },
    { kw: "세텍",             venue: "SETEC",                region: "서울" },
    { kw: "aT센터",           venue: "aT센터",               region: "서울" },
    { kw: "AT센터",           venue: "aT센터",               region: "서울" },
    { kw: "벡스코",           venue: "벡스코",               region: "부산" },
    { kw: "BEXCO",            venue: "벡스코",               region: "부산" },
    { kw: "엑스코",           venue: "엑스코",               region: "대구" },
    { kw: "EXCO",             venue: "엑스코",               region: "대구" },
    { kw: "김대중컨벤션",     venue: "김대중컨벤션센터",     region: "광주" },
    { kw: "수원컨벤션",       venue: "수원컨벤션센터",       region: "경기" },
    { kw: "송도컨벤시아",     venue: "송도컨벤시아",         region: "인천" },
    { kw: "제주국제컨벤션",   venue: "제주국제컨벤션센터",   region: "제주" },
    { kw: "ICC JEJU",         venue: "제주국제컨벤션센터",   region: "제주" },
    { kw: "ICC 제주",         venue: "제주국제컨벤션센터",   region: "제주" },
    { kw: "창원컨벤션",       venue: "창원컨벤션센터",       region: "경남" },
    { kw: "CECO",             venue: "창원컨벤션센터",       region: "경남" },
    { kw: "경주화백",         venue: "경주화백컨벤션센터",   region: "경북" },
    { kw: "대전컨벤션",       venue: "대전컨벤션센터",       region: "대전" },
    { kw: "DCC",              venue: "대전컨벤션센터",       region: "대전" },
    { kw: "군산새만금",       venue: "군산새만금컨벤션센터", region: "전북" },
    { kw: "오스코",           venue: "청주 오스코",          region: "충북" },
    { kw: "OSCO",             venue: "청주 오스코",          region: "충북" },
    { kw: "수성구",           venue: "엑스코",               region: "대구" },
    { kw: "수원메쎄",         venue: "수원메쎄",             region: "경기" },
    { kw: "SUWON MESSE",      venue: "수원메쎄",             region: "경기" },
    { kw: "DDP",              venue: "동대문디자인플라자",   region: "서울" },
    { kw: "동대문디자인",     venue: "동대문디자인플라자",   region: "서울" },
  ];

  // 원본과 괄호 제거본 양쪽으로 체크 (대소문자 무시)
  const loc     = location.replace(/\([^)]+\)/g, "").replace(/\s+/g, " ").trim();
  const locUp   = loc.toUpperCase();
  const origUp  = location.toUpperCase();

  for (const { kw, venue, region } of KNOWN) {
    const kwUp = kw.toUpperCase();
    if (locUp.includes(kwUp) || origUp.includes(kwUp)) return { venue, venue_region: region };
  }

  const REGIONS = ["서울","부산","대구","인천","광주","대전","울산","세종",
                   "경기","강원","충북","충남","전북","전남","경북","경남","제주"];
  const regionMatch = REGIONS.find((r) =>
    loc.startsWith(r) || loc.includes(r + " ") || loc.includes(" " + r)
  ) ?? null;

  // 해외 판별: 국내 지역 미매칭 + (해외 도시명 포함 또는 라틴문자 비중 높음)
  let region = regionMatch;
  if (!region) {
    const OVERSEAS_KW = [
      "쾰른","뒤셀도르프","프랑크푸르트","하노버","뮌헨","밀라노","파리","라스베가스",
      "상하이","쑤저우","광저우","선전","홍콩","도쿄","오사카","싱가포르","두바이",
      "방콕","자카르타","호치민","하노이","뭄바이","보고타","베트남","콜롬비아",
      "미국","독일","중국","일본","인도","태국","프랑스","이탈리아","캐나다","브라질",
      "Messe","Expo","Exhibition","Convention","Fair","Center","Centre",
    ];
    const cleaned = loc.replace(/^etc\s*\(기타\)\s*[:：]?\s*/i, "");
    const latinRatio = (cleaned.match(/[A-Za-z]/g)?.length ?? 0) / Math.max(cleaned.length, 1);
    if (OVERSEAS_KW.some((kw) => cleaned.includes(kw)) || latinRatio > 0.5) {
      region = "해외";
    }
  }

  // 미매칭 → 정리된 텍스트를 venue로: etc(기타)/개최장소 접두어, 층·호·홀 정보 제거
  const cleanVenue = loc
    .replace(/^etc\s*\(기타\)\s*[:：]?\s*/i, "")
    .replace(/^개최장소\s*/, "")
    .replace(/\s+(지하)?\d+층\b.*$/, "")
    .replace(/\s+\d+호\b.*$/, "")
    .replace(/\s+(제?\d+|[A-Z])홀\b.*$/, "")
    .replace(/\s+(전관|일원|일대)$/, "")
    .trim();
  return { venue: cleanVenue || "기타", venue_region: region };
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

    // 쇼알라 상세: <p class="tit">KEY</p or </dt><p class="des ...">VALUE</p> 패턴
    // 주의: tit 태그가 </dt>로 잘못 닫히는 경우 있음 → 양쪽 처리
    const fields: Record<string, string> = {};
    for (const m of html.matchAll(/<p[^>]*class="tit"[^>]*>([\s\S]*?)<\/(?:p|dt)>\s*<p[^>]*class="des[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
      const k = m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      const v = m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      if (k) fields[k] = v;
    }

    // 주최: 키에 &nbsp; 공백이 섞여있어 "주 최" 형태로 파싱됨 → 공백 제거 후 매칭
    const orgEntry = Object.entries(fields).find(([k]) => k.replace(/\s+/g, "").includes("주최"));
    const organizer = cleanOrganizer(orgEntry?.[1] ?? null);

    // 홈페이지: icn_home class href가 가장 안정적
    const homeM = html.match(/href="([^"]+)"[^>]*class="icn_home"|class="icn_home"[^>]*href="([^"]+)"/);
    const rawUrl = homeM?.[1] ?? homeM?.[2] ?? null;
    const website = rawUrl?.startsWith("http") ? rawUrl : null;

    // 전시분야·산업분야 모두 체크
    const display_industry = fields["전시분야"] ?? fields["산업분야"] ?? null;

    return { organizer, website, display_industry };
  } catch {
    return { organizer: null, website: null, display_industry: null };
  }
}

// ── 쇼알라 ──────────────────────────────────────────────────────

async function scrapeShowala(noiseFilters: NoiseFilters): Promise<ScrapedEvent[]> {
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
    if (isNoise(event_name, resolvedIndustry, noiseFilters)) {
      noiseCount++;
      continue;
    }

    events.push({
      venue, venue_region, event_name, event_name_en,
      start_date: dates.start, end_date: dates.end,
      location, category: classifyCategory(event_name),
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

async function scrapeKeoa(noiseFilters: NoiseFilters): Promise<ScrapedEvent[]> {
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

        if (isNoise(event_name, fields["출품품목"] || null, noiseFilters)) {
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
          location: venueRaw || null, category: classifyCategory(event_name),
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

// ── DB upsert 공통 헬퍼 ───────────────────────────────────────────

type ExRow = {
  id: string; event_name: string; start_date: string;
  organizer: string | null; website: string | null;
  image_url: string | null; industry: string | null;
  event_name_en: string | null; source: string | null;
};

const GOOGLE_SEARCH_PREFIX = "https://www.google.com/search";

// 진행중·예정 행사 전체를 가져와 정규화 키로 매칭 (공백·표기 차이 흡수)
async function fetchExisting(): Promise<Map<string, ExRow>> {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, organizer, website, image_url, industry, event_name_en, source")
    .gte("end_date", today)
    .limit(3000);
  return new Map(
    (data ?? []).map((e) => [`${normalizeKey(e.event_name)}|${e.start_date}`, e as ExRow])
  );
}

async function batchInsert(events: ScrapedEvent[]): Promise<number> {
  const BATCH = 50;
  for (let i = 0; i < events.length; i += BATCH) {
    const { error } = await supabase.from("convention_events").insert(events.slice(i, i + BATCH));
    if (error) console.error("삽입 오류:", error.message);
  }
  return events.length;
}

async function batchUpdate(updates: { id: string; fields: Record<string, unknown> }[]): Promise<number> {
  for (const { id, fields } of updates) {
    const { error } = await supabase.from("convention_events").update(fields).eq("id", id);
    if (error) console.error(`update ${id} 오류:`, error.message);
  }
  return updates.length;
}

// ── KEOA upsert (primary) ─────────────────────────────────────────
// KEOA = 기준 소스. 신규면 INSERT, 기존이면 null 필드만 보강.

async function upsertKeoaEvents(events: ScrapedEvent[]): Promise<{ inserted: number; updated: number }> {
  if (!events.length) return { inserted: 0, updated: 0 };

  const existingMap = await fetchExisting();
  const toInsert: ScrapedEvent[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

  for (const event of events) {
    const key = `${normalizeKey(event.event_name)}|${event.start_date}`;
    const ex  = existingMap.get(key);

    if (!ex) {
      toInsert.push(event);
    } else {
      const updates: Record<string, unknown> = {};
      if (!ex.organizer && event.organizer)       updates.organizer     = event.organizer;
      if (!ex.industry && event.industry)         updates.industry      = event.industry;
      if (!ex.event_name_en && event.event_name_en) updates.event_name_en = event.event_name_en;
      // manual로 들어온 기존 데이터 → 실제 소스로 업데이트
      if (ex.source === "manual")                 updates.source        = "keoa";
      if (Object.keys(updates).length > 0) toUpdate.push({ id: ex.id, fields: updates });
    }
  }

  await batchInsert(toInsert);
  await batchUpdate(toUpdate);
  console.log(`KEOA: 신규 ${toInsert.length}건, 보강 ${toUpdate.length}건`);
  return { inserted: toInsert.length, updated: toUpdate.length };
}

// ── 쇼알라 supplement (secondary) ────────────────────────────────
// 쇼알라 = 보조 소스.
// KEOA row 매칭 → image_url·website·industry 채움 (source 유지)
// 매칭 없음 → INSERT source='showala'

async function supplementFromShowala(events: ScrapedEvent[]): Promise<{ inserted: number; updated: number }> {
  if (!events.length) return { inserted: 0, updated: 0 };

  const existingMap = await fetchExisting();
  const toInsert: ScrapedEvent[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

  for (const event of events) {
    const key = `${normalizeKey(event.event_name)}|${event.start_date}`;
    const ex  = existingMap.get(key);

    if (!ex) {
      toInsert.push(event);
    } else {
      const updates: Record<string, unknown> = {};
      if (!ex.image_url && event.image_url) updates.image_url = event.image_url;
      if (!ex.industry && event.industry)   updates.industry  = event.industry;
      if (!ex.event_name_en && event.event_name_en) updates.event_name_en = event.event_name_en;
      // 구글 검색 URL이거나 null이면 실제 홈페이지로 교체
      if (event.website && (!ex.website || ex.website.startsWith(GOOGLE_SEARCH_PREFIX))) {
        updates.website = event.website;
      }
      // manual → showala (KEOA에 없는 쇼알라 전용 행사)
      if (ex.source === "manual") updates.source = "showala";
      if (Object.keys(updates).length > 0) toUpdate.push({ id: ex.id, fields: updates });
    }
  }

  await batchInsert(toInsert);
  await batchUpdate(toUpdate);
  console.log(`쇼알라: 신규 ${toInsert.length}건, 보강 ${toUpdate.length}건`);
  return { inserted: toInsert.length, updated: toUpdate.length };
}

// ── 키워드 필터 자동 비공개 ──────────────────────────────────────────

async function applyKeywordFilters(): Promise<number> {
  // 행사명 키워드만 비공개 처리 (industry 타입은 수집 차단 전용)
  const { data: filters } = await supabase
    .from("event_keyword_filters")
    .select("keyword, filter_type");
  const nameFilters = (filters ?? []).filter(
    (f) => ((f as { filter_type: string | null }).filter_type ?? "name") === "name"
  );
  if (!nameFilters.length) return 0;

  let autoHidden = 0;
  for (const { keyword } of nameFilters) {
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
    // 노이즈 키워드 로드 (DB 관리 — 어드민에서 수정 즉시 반영)
    const noiseFilters = await loadNoiseFilters();
    console.log(`노이즈 필터: 행사명 ${noiseFilters.nameKw.length}개, 분야 ${noiseFilters.industryKw.length}개`);

    // 쇼알라 + KEOA 병렬 수집
    const [showalaEvents, keoaEvents] = await Promise.all([
      scrapeShowala(noiseFilters),
      scrapeKeoa(noiseFilters),
    ]);

    // KEOA 먼저 저장 (primary), 쇼알라로 보강 (secondary)
    const { inserted: kInserted, updated: kUpdated } = await upsertKeoaEvents(keoaEvents);
    const { inserted: sInserted, updated: sUpdated } = await supplementFromShowala(showalaEvents);
    const inserted = kInserted + sInserted;
    const updated  = kUpdated  + sUpdated;

    // 키워드 필터 자동 비공개 (DB에 저장된 키워드 기준)
    const autoHidden = await applyKeywordFilters();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`완료 (${elapsed}s): 신규 ${inserted}건, 보강 ${updated}건, 비공개 ${autoHidden}건`);

    // 실행 이력 기록 — 수집 0건이면 사이트 구조 변경 가능성
    await supabase.from("scrape_logs").insert({
      ok: true,
      showala_scraped: showalaEvents.length,
      keoa_scraped: keoaEvents.length,
      inserted, updated, auto_hidden: autoHidden,
      elapsed_sec: Number(elapsed),
      error: (showalaEvents.length === 0 || keoaEvents.length === 0)
        ? "경고: 수집 0건 소스 있음 — 사이트 구조 변경 확인 필요" : null,
    });

    return new Response(
      JSON.stringify({ ok: true, inserted, updated, autoHidden, elapsed }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("오류:", (e as Error).message);
    await supabase.from("scrape_logs").insert({
      ok: false,
      elapsed_sec: (Date.now() - started) / 1000,
      error: (e as Error).message,
    }).then(() => {}, () => {});
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
