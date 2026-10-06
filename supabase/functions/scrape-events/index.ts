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

// filter_type: 'category' = AKEI 전시분야(category 컬럼) 포함 매칭 — 관리자가 비공개로 돌려온 분야를 수집 단계에서 미리 제외
type NoiseFilters = { nameKw: string[]; industryKw: string[]; categoryKw: string[]; exceptions: Set<string> };

async function loadNoiseFilters(): Promise<NoiseFilters> {
  const { data } = await supabase.from("event_keyword_filters").select("keyword, filter_type");
  const rows = (data ?? []) as { keyword: string; filter_type: string | null }[];
  // "제외하지 않기"로 허용한 행사 — 07_events_ui.sql 적용 전이면 테이블이 없어 빈 목록
  const { data: ex } = await supabase.from("event_filter_exceptions").select("name_key");
  return {
    nameKw:     rows.filter((r) => (r.filter_type ?? "name") === "name").map((r) => r.keyword),
    industryKw: rows.filter((r) => r.filter_type === "industry").map((r) => r.keyword),
    categoryKw: rows.filter((r) => r.filter_type === "category").map((r) => r.keyword),
    exceptions: new Set(((ex ?? []) as { name_key: string }[]).map((r) => r.name_key)),
  };
}

// 걸리면 제외 사유(문자열), 아니면 null — 사유는 scrape_logs.dropped 로 남겨 오탐을 확인할 수 있게 함
function noiseReason(name: string, industry: string | null, category: string | null, f: NoiseFilters): string | null {
  const lname = name.toLowerCase();
  if (NOISE_NAME_EXACT.has(name)) return "행사명:대관";
  const n = f.nameKw.find((kw) => lname.includes(kw.toLowerCase()));
  if (n) return `행사명:${n}`;
  const i = industry ? f.industryKw.find((kw) => industry.includes(kw)) : null;
  if (i) return `품목:${i}`;
  const c = category ? f.categoryKw.find((kw) => category.includes(kw)) : null;
  if (c) return `분야:${c}`;
  return null;
}

// 제외 내역 수집기 — 소스별 실행 하나에서 공유
// c = 제외된 행사 전체 정보 — 관리자가 "제외하지 않기"를 누르면 이 값으로 바로 등록할 수 있게 함
type Dropped = { name: string; date: string; reason: string; source: string; c?: ScrapedEvent };
const droppedLog: Dropped[] = [];
const droppedByRule: Record<string, number> = {};
let droppedTotal = 0;
function dropIfNoise(source: string, name: string, date: string, industry: string | null, category: string | null, f: NoiseFilters, cand?: ScrapedEvent): boolean {
  const reason = noiseReason(name, industry, category, f);
  if (!reason) return false;
  if (f.exceptions.has(normalizeKey(name) || name.toLowerCase())) return false;   // 관리자가 허용한 행사
  droppedTotal++;
  droppedByRule[reason] = (droppedByRule[reason] ?? 0) + 1;
  if (droppedLog.length < 200) droppedLog.push({ name, date, reason, source, c: cand });
  return true;
}

// ── 유틸 ──────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Edge Function 한도(150s) 안에서 끝내기 위한 마감 — 넘으면 수집을 멈추고 경고로 남김
const DEADLINE = Date.now() + 135_000;
const warnings: string[] = [];

// 매칭 키 정규화: 소문자화 + 공백·특수문자 제거 ("서울 모터쇼" = "서울모터쇼")
// 소스마다 표기가 달라 같은 행사가 중복되던 것을 줄이려고 "제N회", 앞쪽 연도, 괄호 부가설명도 제거
function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, "")
    .replace(/제?\s*\d+\s*(회|차)\b/g, "")
    .replace(/20\d{2}\s*(년도|년)?/g, "")
    .replace(/[\s·,&\-–—_.:!'"~]/g, "");
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
    if (dropIfNoise("showala", event_name, dates.start, resolvedIndustry, null, noiseFilters, {
      venue, venue_region, event_name, event_name_en, start_date: dates.start, end_date: dates.end, location,
      category: classifyCategory(event_name), industry: resolvedIndustry, organizer: detail.organizer, image_url,
      website: detail.website ?? `https://www.showala.com${hrefM[1]}`, is_published: true, source: "showala",
    })) {
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
      if (Date.now() > DEADLINE) {
        if (!warnings.some((w) => w.startsWith("KEOA 시간 초과"))) warnings.push(`KEOA 시간 초과 — ${year}-${month} 부근에서 중단, 이후 월 미수집`);
        break;
      }
      seenIds.add(id);
      await sleep(120);

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

        const keImgM = detailHtml.match(
          /<img[^>]+src="([^"]+)"[^>]*class="[^"]*poster[^"]*"|<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/i
        ) ?? detailHtml.match(/<img[^>]+src="(\/uploads\/[^"]+\.(jpg|jpeg|png|webp))"[^>]*>/i);
        const keImageRaw = keImgM ? (keImgM[1] || keImgM[2]) : null;
        const image_url  = keImageRaw
          ? (keImageRaw.startsWith("http") ? keImageRaw : `https://www.keoa.org${keImageRaw}`)
          : null;

        const ev: ScrapedEvent = {
          venue, venue_region, event_name, event_name_en,
          start_date: dates.start, end_date: dates.end,
          location: venueRaw || null, category: classifyCategory(event_name),
          industry: fields["출품품목"] || null,
          organizer,
          image_url,
          website: null, // KEOA에는 실제 홈페이지 URL 없음
          is_published: true,
          source: "keoa",
        };
        if (dropIfNoise("keoa", event_name, dates.start, fields["출품품목"] || null, null, noiseFilters, ev)) {
          noiseCount++;
          continue;
        }
        events.push(ev);
      } catch (e) {
        console.warn(`  ID ${id} 실패:`, (e as Error).message);
      }
    }

    await sleep(400);
  }

  console.log(`KEOA: ${events.length}건 수집, ${noiseCount}건 노이즈 제거`);
  return events;
}

// ── AKEI (한국전시산업진흥회) ─────────────────────────────────────
// 월별 목록 페이지 하나에 상세 정보(주최·분야·세부품목·홈페이지)가 모두 들어 있어 상세 요청이 필요 없음.
// 기존 수동 흐름(docs/exhibition_crawler.py → 엑셀 → 업로드)을 서버 수집으로 대체.

const AKEI_BASE = "https://www.akei.or.kr/bbs/board.php";
const AKEI_MONTHS_AHEAD = 10; // 이번 달 + 9개월 — 분기 실행 사이 공백이 없도록 넉넉히

const stripTags = (s: string) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

async function fetchAkeiPage(year: number, month: number, page: number): Promise<string | null> {
  const url = `${AKEI_BASE}?bo_table=schedule&sfl=wr_subject&sop=and&searchYear=${year}&searchMonth=${String(month).padStart(2, "0")}&page=${page}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EZNewsroom/1.0)" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.text();
    } catch { /* 재시도 */ }
    await sleep(800);
  }
  return null;
}

function akeiTotalPages(html: string): number {
  const nav = html.match(/<nav[^>]*pg_wrap[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  const pages = [...nav.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  return Math.min(Math.max(1, ...pages), 20);
}

async function scrapeAkei(noiseFilters: NoiseFilters): Promise<ScrapedEvent[]> {
  console.log("AKEI 스크래핑...");
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const events: ScrapedEvent[] = [];
  const seen = new Set<string>();
  let noiseCount = 0, rawItems = 0, parseFail = 0, pageFail = 0;

  for (let i = 0; i < AKEI_MONTHS_AHEAD; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page++) {
      if (Date.now() > DEADLINE) {
        if (!warnings.some((w) => w.startsWith("AKEI 시간 초과"))) warnings.push(`AKEI 시간 초과 — ${year}-${month} 부근에서 중단`);
        return events;
      }
      const html = await fetchAkeiPage(year, month, page);
      if (!html) { pageFail++; continue; }
      if (page === 1) totalPages = akeiTotalPages(html);

      for (const item of html.split('<li class="content_sc_li"').slice(1)) {
        rawItems++;
        const fields: Record<string, string> = {};
        let homepage: string | null = null;
        for (const m of item.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td([^>]*)>([\s\S]*?)<\/td>/g)) {
          const k = stripTags(m[1]).replace(/\s+/g, "");
          if (!k || k in fields) continue;
          fields[k] = stripTags(m[3]);
          if (k === "홈페이지") homepage = m[3].match(/href="([^"]+)"/)?.[1] ?? null;
        }
        const event_name = (fields["전시회명(한글)"] ?? "").replace(/\s+/g, " ").trim();
        const dates = parseDateRange((fields["기간"] ?? "").replace(/\s+/g, ""));
        if (!event_name || !dates) { parseFail++; continue; }
        if (dates.end < todayStr) continue;

        const dupKey = `${event_name}|${dates.start}`;
        if (seen.has(dupKey)) continue;
        seen.add(dupKey);

        const category = (fields["전시분야"] ?? "").replace(/^\d+\s*\.\s*/, "").trim() || null;
        const industry = (fields["세부품목"] ?? "")
          .split("\n").map((s) => s.replace(/^[-•·\s]+/, "").trim()).filter(Boolean).join(", ").slice(0, 300) || null;

        // 품목 규칙은 긴 세부품목 본문이 아니라 짧은 분야명에만 적용 — 본문 전체에 걸면 "농업" 같은 단어 하나로 무관한 행사가 빠짐
        const location = fields["장소"] || null;
        const { venue, venue_region } = parseVenueInfo(location);
        const imgSrc = item.match(/<div class="img">[\s\S]*?<img[^>]+src="([^"]+)"/)?.[1] ?? null;
        const image_url = imgSrc && !imgSrc.includes("no_img") ? new URL(imgSrc, AKEI_BASE).toString() : null;
        const site = homepage && /^https?:\/\//i.test(homepage) ? homepage : null;

        const ev: ScrapedEvent = {
          venue, venue_region, event_name,
          event_name_en: (fields["전시회명(영문)"] || "").trim() || null,
          start_date: dates.start, end_date: dates.end, location,
          category: category ?? classifyCategory(event_name), industry,
          organizer: (fields["주최"] || "").trim() || null,
          image_url, website: site, is_published: true, source: "akei",
        };
        // 품목 규칙은 긴 세부품목 본문이 아니라 짧은 분야명에만 적용 — 본문 전체에 걸면 "농업" 같은 단어 하나로 무관한 행사가 빠짐
        if (dropIfNoise("akei", event_name, dates.start, category, category, noiseFilters, ev)) { noiseCount++; continue; }
        events.push(ev);
      }
      await sleep(300);
    }
    await sleep(400);
  }

  // 파싱이 절반 넘게 깨졌거나 한 페이지도 못 받았으면 사이트 구조 변경 가능성
  if (rawItems > 0 && parseFail / rawItems > 0.5) warnings.push(`AKEI 파싱 실패율 높음 (${parseFail}/${rawItems}) — 사이트 구조 변경 확인`);
  if (pageFail > 0) warnings.push(`AKEI 페이지 ${pageFail}개 요청 실패`);
  console.log(`AKEI: ${events.length}건 수집 (원본 ${rawItems}), ${noiseCount}건 노이즈 제거`);
  return events;
}

// ── DB 병합 (소스 공통) ───────────────────────────────────────────
// 신규면 INSERT, 기존이면 빈 필드만 채움. 이미 비공개인 행사도 매칭 대상이라 다시 살아나지 않음.
// 06_event_changes.sql 적용 후에는 추가로 변경 감지(일정 변경 의심·값 변경·소스에서 사라짐)를 event_changes 에 기록.
// 기존 값은 자동으로 덮어쓰지 않고, 관리자가 검토 화면에서 고르게 함.

type ExRow = {
  id: string; event_name: string; start_date: string; end_date: string | null;
  organizer: string | null; website: string | null; image_url: string | null;
  industry: string | null; event_name_en: string | null; source: string | null;
  category: string | null; venue_region: string | null; venue?: string | null;
  is_published?: boolean | null; seen_at?: Record<string, string> | null;
};
type ExIdxRow = ExRow & { loose: string; looseEn: string; host: string };
type ExIdx = Map<string, ExIdxRow[]>;

const GOOGLE_SEARCH_PREFIX = "https://www.google.com/search";
const looseKey = (name: string) => normalizeKey(name) || name.toLowerCase();

// 같은 행사가 한글명/영문명으로 따로 등록되는 경우를 잡기 위해 홈페이지 도메인도 비교 (소스 사이트·포털 도메인은 제외)
const GENERIC_HOSTS = /(^|\.)(showala\.com|keoa\.org|akei\.or\.kr|google\.com|naver\.com|daum\.net|facebook\.com|instagram\.com|youtube\.com|tistory\.com|blog\.me|kita\.net|kotra\.or\.kr)$/;
function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return GENERIC_HOSTS.test(h) ? "" : h;
  } catch { return ""; }
}

// 06_event_changes.sql 적용 여부 — 미적용이면 변경 감지 없이 기존 방식으로 동작
let changesReady = false;
async function checkChangesReady(): Promise<boolean> {
  const a = await supabase.from("event_changes").select("id").limit(1);
  const b = await supabase.from("convention_events").select("seen_at").limit(1);
  changesReady = !a.error && !b.error;
  if (!changesReady) warnings.push("06_event_changes.sql 미실행 — 변경 감지 없이 수집만 진행");
  return changesReady;
}

// 진행중·예정 행사 전체(비공개 포함)를 시작일별로 묶어 표기 차이를 흡수해 매칭
async function fetchExisting(): Promise<ExIdx> {
  const today = new Date().toISOString().split("T")[0];
  const cols = "id, event_name, start_date, end_date, organizer, website, image_url, industry, event_name_en, source, category, venue_region, venue, is_published"
    + (changesReady ? ", seen_at" : "");
  const { data } = await supabase.from("convention_events").select(cols).gte("end_date", today).limit(5000);
  const idx: ExIdx = new Map();
  for (const e of (data ?? []) as ExRow[]) addToIdx(idx, e);
  return idx;
}
function addToIdx(idx: ExIdx, e: ExRow) {
  const list = idx.get(e.start_date) ?? [];
  list.push({ ...e, loose: looseKey(e.event_name), looseEn: e.event_name_en ? looseKey(e.event_name_en) : "", host: hostOf(e.website) });
  idx.set(e.start_date, list);
}
// 같은 시작일 + (정규화 이름 동일 | 한쪽이 다른 쪽을 포함(6자 이상) | 영문명이 상대의 이름과 동일 | 같은 홈페이지 도메인)
// 홈페이지 도메인은 한 주최사가 같은 날 여러 행사를 여는 경우(예: 동아전람)가 많아서, 양쪽에서 그 도메인이 유일할 때만 근거로 씀
function matchExisting(idx: ExIdx, ev: { event_name: string; start_date: string; event_name_en?: string | null; website?: string | null }, hostUnique = true) {
  const key = looseKey(ev.event_name);
  const keyEn = ev.event_name_en ? looseKey(ev.event_name_en) : "";
  const host = hostOf(ev.website);
  const list = idx.get(ev.start_date) ?? [];
  const sameHost = host && hostUnique ? list.filter((x) => x.host === host) : [];
  return list.find((x) => x.loose === key)
    ?? list.find((x) => Math.min(x.loose.length, key.length) >= 6 && (x.loose.includes(key) || key.includes(x.loose)))
    ?? (keyEn.length >= 5 ? list.find((x) => x.loose === keyEn || x.looseEn === keyEn || x.looseEn === key) : undefined)
    ?? (sameHost.length === 1 ? sameHost[0] : undefined);
}

// 시작일만 다른 같은 행사 후보 — 일정 변경이 의심되는 기존 행사 (같은 이름 계열, 시작일 차이 60일 이내)
function findDateSuspect(idx: ExIdx, ev: ScrapedEvent, claimed: Set<string>): ExIdxRow | undefined {
  const key = looseKey(ev.event_name);
  const keyEn = ev.event_name_en ? looseKey(ev.event_name_en) : "";
  const t0 = Date.parse(ev.start_date);
  let best: ExIdxRow | undefined; let bestDiff = Infinity;
  for (const list of idx.values()) {
    for (const x of list) {
      if (!x.id || claimed.has(x.id) || x.start_date === ev.start_date) continue;
      const diff = Math.abs(Date.parse(x.start_date) - t0) / 86_400_000;
      if (!(diff <= 60) || diff >= bestDiff) continue;
      const similar = x.loose === key
        || (Math.min(x.loose.length, key.length) >= 6 && (x.loose.includes(key) || key.includes(x.loose)))
        || (keyEn.length >= 5 && (x.loose === keyEn || x.looseEn === keyEn));
      if (similar) { best = x; bestDiff = diff; }
    }
  }
  return best;
}

// 주최 표기 비교용 — (주)·㈜·주식회사·공백 제거. 한쪽이 다른 쪽을 포함하면 같은 것으로 봄
const orgKey = (s: string) => s.toLowerCase().replace(/\(주\)|㈜|주식회사|\(사\)|사단법인|[\s,·/&]/g, "");
function orgDiffers(a: string, b: string): boolean {
  const x = orgKey(a), y = orgKey(b);
  if (!x || !y) return false;
  return !(x.includes(y) || y.includes(x));
}

// 이름 유사도 — 정규화한 이름의 2글자 조합(bigram) Dice 계수. 한글/영문 번역 중복이 아니라 표기만 다른 중복을 잡는 용도
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const A = grams(a), B = grams(b); let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}
const venueKey = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s·.,\-]/g, "").slice(0, 4);

// 같은 날 같은 주최나 같은 장소에서 이름이 비슷한 기존 행사 — 표기만 달라 못 알아본 같은 행사일 가능성
function findDupSuspect(idx: ExIdx, ev: ScrapedEvent, claimed: Set<string>): ExIdxRow | undefined {
  const key = looseKey(ev.event_name);
  const org = ev.organizer ? orgKey(ev.organizer) : "";
  const ven = venueKey(ev.venue);
  let best: ExIdxRow | undefined; let bestScore = 0;
  for (const x of idx.get(ev.start_date) ?? []) {
    if (!x.id || claimed.has(x.id) || x.is_published === false) continue;
    const s = dice(key, x.loose);
    const xo = x.organizer ? orgKey(x.organizer) : "";
    const sameOrg = org.length >= 3 && xo.length >= 3 && (org.includes(xo) || xo.includes(org));
    const sameVenue = ven.length >= 2 && ven === venueKey(x.venue);
    if ((s >= 0.65 && (sameOrg || sameVenue)) || s >= 0.8) { if (s > bestScore) { best = x; bestScore = s; } }
  }
  return best;
}

type NewChange = { kind: "new" | "date_suspect" | "field_change" | "missing" | "duplicate_suspect" | "concurrent"; event_id: string | null; dedupe_key: string; payload: Record<string, unknown> };
type ChangeKeys = Map<string, { status: string; resolution: string | null }>;

async function loadChangeKeys(): Promise<ChangeKeys> {
  const keys: ChangeKeys = new Map();
  if (!changesReady) return keys;
  const { data } = await supabase.from("event_changes").select("dedupe_key, status, resolution").limit(50000);
  for (const r of (data ?? []) as { dedupe_key: string; status: string; resolution: string | null }[]) keys.set(r.dedupe_key, { status: r.status, resolution: r.resolution });
  return keys;
}

async function batchInsert(events: (ScrapedEvent & { seen_at?: Record<string, string> })[]): Promise<{ id: string; ev: ScrapedEvent }[]> {
  const out: { id: string; ev: ScrapedEvent }[] = [];
  for (let i = 0; i < events.length; i += 50) {
    const batch = events.slice(i, i + 50);
    const { data, error } = await supabase.from("convention_events").insert(batch).select("id");
    if (error) { console.error("삽입 오류:", error.message); warnings.push(`삽입 오류: ${error.message}`.slice(0, 200)); continue; }
    (data ?? []).forEach((r: { id: string }, k: number) => out.push({ id: r.id, ev: batch[k] }));
  }
  return out;
}

async function batchUpdate(updates: { id: string; fields: Record<string, unknown> }[]): Promise<number> {
  let ok = 0;
  for (const { id, fields } of updates) {
    const { error } = await supabase.from("convention_events").update(fields).eq("id", id);
    if (error) console.error(`update ${id} 오류:`, error.message); else ok++;
  }
  return ok;
}

type MergePlan = {
  toInsert: ScrapedEvent[];
  toUpdate: { id: string; fields: Record<string, unknown> }[];
  changes: NewChange[];
  suspectNames: string[];
};

// 한 소스의 수집 결과를 기존 행사와 대조해 계획만 세움 (DB 쓰기 없음) — dry 와 live 가 같은 계획을 씀
function planMerge(source: string, events: ScrapedEvent[], idx: ExIdx, keys: ChangeKeys, nowIso: string): MergePlan {
  const plan: MergePlan = { toInsert: [], toUpdate: [], changes: [], suspectNames: [] };
  const canPropose = changesReady && (source === "akei" || source === "keoa"); // 쇼알라는 목록이 일부라 변경 제안 근거로 쓰지 않음
  const stamp = (ex: ExIdxRow) => ({ ...(ex.seen_at ?? {}), [source]: nowIso });
  const claimed = new Set<string>();

  // 이번 수집 안에서 같은 날 같은 도메인을 쓰는 행사가 여럿이면 도메인 매칭을 쓰지 않음
  const hostCount = new Map<string, number>();
  for (const ev of events) { const h = hostOf(ev.website); if (h) hostCount.set(`${ev.start_date}|${h}`, (hostCount.get(`${ev.start_date}|${h}`) ?? 0) + 1); }

  const unmatched: ScrapedEvent[] = [];
  for (const ev of events) {
    const ex = matchExisting(idx, ev, (hostCount.get(`${ev.start_date}|${hostOf(ev.website)}`) ?? 0) <= 1);
    if (!ex) { unmatched.push(ev); continue; }
    if (ex.id) claimed.add(ex.id);

    const f: Record<string, unknown> = {};
    if (!ex.organizer && ev.organizer) f.organizer = ev.organizer;
    if (!ex.industry && ev.industry) f.industry = ev.industry;
    if (!ex.event_name_en && ev.event_name_en) f.event_name_en = ev.event_name_en;
    if (!ex.image_url && ev.image_url) f.image_url = ev.image_url;
    if (!ex.venue_region && ev.venue_region) f.venue_region = ev.venue_region;
    if (!ex.end_date && ev.end_date) f.end_date = ev.end_date;
    // 분야(category)는 AKEI 만 신뢰 — KEOA·쇼알라의 category 는 전시/컨퍼런스 구분값
    if (source === "akei" && !ex.category && ev.category) f.category = ev.category;
    if (ev.website && (!ex.website || ex.website.startsWith(GOOGLE_SEARCH_PREFIX))) f.website = ev.website;
    // 수동 입력으로 들어온 행이 실제 소스에서 확인되면 출처 갱신
    if (ex.source === "manual" || !ex.source) f.source = source;
    if (changesReady && ex.id) f.seen_at = stamp(ex);

    // 값 변경 — 이미 값이 있는데 소스와 다르면 덮어쓰지 않고 검토 대기열로 (공개 행사만)
    if (canPropose && ex.id && ex.is_published !== false) {
      const propose = (field: string, oldV: string, newV: string) => {
        const key = `field|${ex.id}|${field}|${newV}`;
        if (!keys.has(key)) plan.changes.push({ kind: "field_change", event_id: ex.id, dedupe_key: key, payload: { field, old: oldV, new: newV, source } });
      };
      if (ex.end_date && ev.end_date && ex.end_date !== ev.end_date) propose("end_date", ex.end_date, ev.end_date);
      // 주최·홈페이지는 AKEI 값이 더 정확하므로, AKEI 가 이미 확인한 행사에 대해 KEOA 가 다른 값을 제안하지는 않음
      const akeiOwns = source === "keoa" && !!ex.seen_at?.akei;
      if (!akeiOwns && ex.organizer && ev.organizer && orgDiffers(ex.organizer, ev.organizer)) propose("organizer", ex.organizer, ev.organizer);
      const h1 = hostOf(ex.website), h2 = hostOf(ev.website);
      if (!akeiOwns && h1 && h2 && h1 !== h2 && ev.website) propose("website", ex.website!, ev.website);
    }
    if (Object.keys(f).length) plan.toUpdate.push({ id: ex.id, fields: f });
  }

  for (const ev of unmatched) {
    const cand = canPropose ? findDateSuspect(idx, ev, claimed) : undefined;
    if (cand) {
      if (cand.is_published === false) continue; // 이미 비공개로 돌린 행사의 일정 이동 — 새로 올리지도 묻지도 않음
      const key = `date|${cand.id}|${ev.start_date}`;
      const k = keys.get(key);
      if (!k) {
        plan.changes.push({
          kind: "date_suspect", event_id: cand.id, dedupe_key: key,
          payload: { source, old: { start_date: cand.start_date, end_date: cand.end_date }, candidate: ev },
        });
        plan.suspectNames.push(ev.event_name);
        claimed.add(cand.id);
        continue;
      }
      if (k.resolution !== "separate") continue; // 검토 대기 중이거나 이미 일정 변경으로 처리됨 — 새로 올리지 않음
      // "별개 행사"로 확인된 짝 → 아래에서 신규로 등록
    }
    // 표기만 다른 같은 행사 의심 — 같은 날 같은 주최·장소에 이름이 비슷한 기존 행사가 있으면 새로 넣지 않고 관리자에게 묻기
    const dup = canPropose ? findDupSuspect(idx, ev, claimed) : undefined;
    if (dup) {
      const key = `dup|${dup.id}|${looseKey(ev.event_name)}|${ev.start_date}`;
      const k = keys.get(key);
      if (!k) {
        plan.changes.push({ kind: "duplicate_suspect", event_id: dup.id, dedupe_key: key, payload: { source, candidate: ev } });
        plan.suspectNames.push(ev.event_name);
        continue;
      }
      if (k.resolution !== "separate") continue; // 대기 중이거나 이미 같은 행사로 합쳐짐
    }
    plan.toInsert.push(ev);
    addToIdx(idx, { ...ev, id: "" });
  }
  return plan;
}

// 소스 목록에서 사라진 행사 — 이전 수집에서 이 소스가 확인한 적이 있고, 소스의 조회 범위 안인데 이번엔 안 보임
function planMissing(source: string, idx: ExIdx, seenIds: Set<string>, runStartIso: string, windowEnd: string, keys: ChangeKeys): NewChange[] {
  const out: NewChange[] = [];
  const ym = runStartIso.slice(0, 7);
  for (const list of idx.values()) for (const x of list) {
    if (!x.id || seenIds.has(x.id) || x.is_published === false || x.start_date > windowEnd) continue;
    const prev = x.seen_at?.[source];
    if (!prev || prev >= runStartIso) continue;
    const key = `missing|${x.id}|${source}|${ym}`;
    if (keys.has(key)) continue;
    out.push({ kind: "missing", event_id: x.id, dedupe_key: key, payload: { source, last_seen: prev, seen_at: x.seen_at ?? {} } });
  }
  return out;
}

async function saveChanges(source: string, changes: NewChange[]) {
  if (!changesReady || !changes.length) return;
  for (let i = 0; i < changes.length; i += 100) {
    const rows = changes.slice(i, i + 100).map((c) => ({ ...c, source }));
    const { error } = await supabase.from("event_changes").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) { console.error("변경 내역 저장 오류:", error.message); warnings.push(`변경 내역 저장 오류: ${error.message}`.slice(0, 200)); }
  }
}

// 소스별 조회 범위의 마지막 날 — 사라짐 판정은 이 범위 안의 행사만
function windowEndOf(source: string): string {
  const t = new Date();
  const months = source === "akei" ? AKEI_MONTHS_AHEAD : 7;
  return new Date(Date.UTC(t.getFullYear(), t.getMonth() + months, 0)).toISOString().slice(0, 10);
}

type MergeResult = { inserted: number; updated: number; pending: Record<string, number> };

async function mergeEvents(source: string, events: ScrapedEvent[], runStartIso: string, truncated: boolean): Promise<MergeResult> {
  if (!events.length) return { inserted: 0, updated: 0, pending: {} };
  const nowIso = new Date().toISOString();
  const idx = await fetchExisting();
  const keys = await loadChangeKeys();
  const plan = planMerge(source, events, idx, keys, nowIso);

  const insertRows = plan.toInsert.map((e) => (changesReady ? { ...e, seen_at: { [source]: nowIso } } : e));
  const inserted = await batchInsert(insertRows);
  const updated = await batchUpdate(plan.toUpdate);

  // 새로 들어온 행사 — 관리자가 한 번 훑어볼 수 있게 기록
  const newChanges: NewChange[] = inserted.map((r) => ({ kind: "new", event_id: r.id, dedupe_key: `new|${r.id}`, payload: { source } }));
  const changes = [...plan.changes, ...newChanges];

  // 사라진 행사 — 수집이 온전했을 때만 (시간 초과·페이지 실패가 있으면 오탐이 되므로 건너뜀), 쇼알라는 제외
  if (changesReady && !truncated && (source === "akei" || source === "keoa")) {
    const seenIds = new Set(plan.toUpdate.map((u) => u.id));
    for (const list of idx.values()) for (const x of list) if (x.id && matchSeen(events, x)) seenIds.add(x.id);
    changes.push(...planMissing(source, idx, seenIds, runStartIso, windowEndOf(source), keys));
  }
  await saveChanges(source, changes);

  const pending: Record<string, number> = {};
  for (const c of changes) pending[c.kind] = (pending[c.kind] ?? 0) + 1;
  console.log(`${source}: 신규 ${inserted.length}건, 보강 ${updated}건, 검토 대기 ${JSON.stringify(pending)}`);
  return { inserted: inserted.length, updated, pending };
}

// 이번 수집 결과 안에서 이 기존 행사와 매칭되는 항목이 있는지 (필드 보강이 없어 update 목록에 안 잡힌 행사도 "확인됨"으로 보기 위해)
function matchSeen(events: ScrapedEvent[], x: ExIdxRow): boolean {
  return events.some((ev) => ev.start_date === x.start_date && (looseKey(ev.event_name) === x.loose
    || (Math.min(x.loose.length, looseKey(ev.event_name).length) >= 6 && (x.loose.includes(looseKey(ev.event_name)) || looseKey(ev.event_name).includes(x.loose)))
    || (ev.event_name_en && (looseKey(ev.event_name_en) === x.loose || looseKey(ev.event_name_en) === x.looseEn))
    || (hostOf(ev.website) && hostOf(ev.website) === x.host)));
}

// ── 규칙 소급 적용 ─────────────────────────────────────────────────
// 새로 추가한 비공개 규칙(행사명·분야)을 이미 들어와 있는 공개 행사에도 적용.
// 이즈픽 행사와, 관리자가 직접 공개/비공개를 바꾼 행사(publish_locked)는 건드리지 않음.

async function applyKeywordFilters(f: NoiseFilters): Promise<number> {
  let hidden = 0;
  const run = async (col: "event_name" | "category", kw: string) => {
    // 대상 조회 — 이즈픽·관리자가 직접 바꾼 행사(publish_locked)·"제외하지 않기"로 허용한 행사는 건너뜀
    let sel = await supabase.from("convention_events").select("id, event_name")
      .ilike(col, `%${kw}%`).eq("is_published", true).eq("is_ezpmp_pick", false).eq("publish_locked", false);
    if (sel.error && /publish_locked/.test(sel.error.message)) {
      // 05_events.sql 적용 전 — 잠금 컬럼 없이 진행
      sel = await supabase.from("convention_events").select("id, event_name")
        .ilike(col, `%${kw}%`).eq("is_published", true).eq("is_ezpmp_pick", false);
    }
    if (sel.error) { console.error(`규칙 적용 오류(${kw}):`, sel.error.message); return; }
    const ids = ((sel.data ?? []) as { id: string; event_name: string }[])
      .filter((r) => !f.exceptions.has(normalizeKey(r.event_name) || r.event_name.toLowerCase()))
      .map((r) => r.id);
    if (!ids.length) return;
    // 비공개 사유(hidden_reason)는 07_events_ui.sql 적용 후부터 기록
    let up = await supabase.from("convention_events").update({ is_published: false, hidden_reason: "rule" }).in("id", ids);
    if (up.error && /hidden_reason/.test(up.error.message)) up = await supabase.from("convention_events").update({ is_published: false }).in("id", ids);
    if (up.error) console.error(`규칙 적용 오류(${kw}):`, up.error.message); else hidden += ids.length;
  };
  for (const kw of f.nameKw) await run("event_name", kw);
  for (const kw of f.categoryKw) await run("category", kw);
  console.log(`규칙 소급 적용: ${hidden}건 비공개`);
  return hidden;
}

// ── 동시개최 묶음 ──────────────────────────────────────────────────
// 같은 시작·종료일 + 같은 장소 + 같은 주최인 행사는 한 행사에 딸려 열리는 동시개최일 가능성이 높음.
//  이미 대표 행사가 정해진 묶음에 새로 들어온 행사는 자동으로 연결하고, 처음 보는 묶음은 관리자에게 대표 행사를 고르게 함.
//  (장소·날짜만 같고 주최가 다른 행사는 묶지 않음 — 킨텍스에서 같은 날 열리는 별개 전시회들)
// 07_events_ui.sql(parent_event_id) 적용 전에는 건너뜀.

async function detectConcurrent(keys: ChangeKeys): Promise<{ linked: number; asked: number }> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("convention_events")
    .select("id, event_name, start_date, end_date, venue, organizer, is_concurrent, parent_event_id")
    .gte("end_date", today).eq("is_published", true).limit(5000);
  if (error) return { linked: 0, asked: 0 };  // 컬럼 없음 등 — 기능 비활성

  type M = { id: string; event_name: string; start_date: string; end_date: string | null; venue: string | null; organizer: string | null; is_concurrent: boolean | null; parent_event_id: string | null };
  const groups = new Map<string, M[]>();
  for (const m of (data ?? []) as M[]) {
    const org = m.organizer ? orgKey(m.organizer) : "";
    const ven = venueKey(m.venue);
    if (org.length < 3 || ven.length < 2) continue;
    const k = `${m.start_date}|${m.end_date ?? ""}|${org}|${ven}`;
    const list = groups.get(k) ?? []; list.push(m); groups.set(k, list);
  }

  let linked = 0; const asks: NewChange[] = [];
  const link = async (ids: string[], parent: string) => {
    if (!ids.length) return;
    const { error: e } = await supabase.from("convention_events").update({ is_concurrent: true, parent_event_id: parent }).in("id", ids);
    if (e) console.error("동시개최 연결 오류:", e.message); else linked += ids.length;
  };

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const parent = members.find((m) => members.some((o) => o.parent_event_id === m.id));
    const unlinked = members.filter((m) => !m.parent_event_id && m.id !== parent?.id);
    if (parent) { await link(unlinked.map((m) => m.id), parent.id); continue; }       // 이미 대표가 있는 묶음 — 자동 연결
    const mains = members.filter((m) => !m.is_concurrent);
    if (mains.length === 1 && members.some((m) => m.is_concurrent)) {                // 수동으로 표시해 둔 묶음 — 남은 한 건이 대표
      await link(members.filter((m) => m.id !== mains[0].id && !m.parent_event_id).map((m) => m.id), mains[0].id);
      continue;
    }
    if (unlinked.length < 2) continue;
    const ids = unlinked.map((m) => m.id).sort();
    const key = `concurrent|${ids.join(",")}`;
    if (keys.has(key)) continue;
    asks.push({
      kind: "concurrent", event_id: null, dedupe_key: key,
      payload: { members: unlinked.map((m) => ({ id: m.id, name: m.event_name })), start_date: unlinked[0].start_date, end_date: unlinked[0].end_date, venue: unlinked[0].venue, organizer: unlinked[0].organizer },
    });
  }
  await saveChanges("auto", asks);
  console.log(`동시개최: 자동 연결 ${linked}건, 관리자 확인 요청 ${asks.length}건`);
  return { linked, asked: asks.length };
}

// ── 디스코드 알림 ─────────────────────────────────────────────────

async function sendAlert(level: "error" | "warning" | "info", title: string, description: string, fields: { name: string; value: string }[] = []) {
  const url = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!url) return;
  const color = { error: 0xdc2626, warning: 0xf59e0b, info: 0x2563eb }[level];
  const label = { error: "🔴 오류", warning: "🟡 경고", info: "🔵 안내" }[level];
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ embeds: [{ title: `${label} · ${title}`.slice(0, 250), description: description.slice(0, 1800), color,
        fields: fields.slice(0, 10).map((x) => ({ name: x.name.slice(0, 250), value: (x.value || "-").slice(0, 900) })), timestamp: new Date().toISOString() }] }),
    });
  } catch (e) { console.error("[discord-alert] 전송 실패:", e); }
}

// ── 메인 핸들러 ───────────────────────────────────────────────────
// POST {} | {source:"akei"|"keoa"|"showala"|"all", dry?:true}
//  소스별로 따로 호출하면 각각 150초를 쓸 수 있어 KEOA 가 오래 걸려도 다른 소스가 막히지 않음 (cron·관리자 버튼이 3개를 나눠 호출)

type SrcName = "akei" | "keoa" | "showala";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const auth       = req.headers.get("authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const validAuth  = (!!CRON_SECRET && (auth === `Bearer ${CRON_SECRET}` || cronHeader === CRON_SECRET))
    || (!!SERVICE_ROLE_KEY && auth === `Bearer ${SERVICE_ROLE_KEY}`);
  if (!validAuth) return new Response("Unauthorized", { status: 401 });

  let body: { source?: string; dry?: boolean } = {};
  try { body = await req.json(); } catch { /* 본문 없음 = 전체 */ }
  const want = body.source && ["akei", "keoa", "showala"].includes(body.source) ? (body.source as SrcName) : "all";
  const dry = body.dry === true;
  const sources: SrcName[] = want === "all" ? ["akei", "keoa", "showala"] : [want];

  const started = Date.now();
  console.log(`scrape-events 시작 (${want}${dry ? ", dry" : ""})`);

  try {
    const noiseFilters = await loadNoiseFilters();
    console.log(`비공개 규칙: 행사명 ${noiseFilters.nameKw.length}, 품목 ${noiseFilters.industryKw.length}, 분야 ${noiseFilters.categoryKw.length}`);

    const scrapers: Record<SrcName, () => Promise<ScrapedEvent[]>> = {
      akei: () => scrapeAkei(noiseFilters),
      keoa: () => scrapeKeoa(noiseFilters),
      showala: () => scrapeShowala(noiseFilters),
    };
    const scraped: Partial<Record<SrcName, ScrapedEvent[]>> = {};
    const errors: Partial<Record<SrcName, string>> = {};
    await Promise.all(sources.map(async (s) => {
      try { scraped[s] = await scrapers[s](); }
      catch (e) { errors[s] = (e as Error).message; console.error(`${s} 수집 실패:`, errors[s]); }
    }));
    // 수집 0건은 사이트 구조 변경으로 보고 실패로 취급 (정상 사이트에서 0건일 수 없음)
    for (const s of sources) if (!errors[s] && (scraped[s]?.length ?? 0) === 0) errors[s] = "수집 0건 — 사이트 구조 변경 또는 접속 차단 의심";

    let inserted = 0, updated = 0, autoHidden = 0;
    const pendingTotal: Record<string, number> = {};
    const wouldDo: Record<string, { insert: number; merge: number; sample: string[]; pending: Record<string, number> }> = {};
    await checkChangesReady();
    // 소스가 시간 초과·페이지 실패로 일부만 읽었으면 "사라짐" 판정을 건너뜀 (오탐 방지)
    const truncated = (s: SrcName) => warnings.some((w) => w.toLowerCase().startsWith(s) && /시간 초과|실패/.test(w));
    if (dry) {
      // 시험 실행 — DB 에 쓰지 않고 소스별로 신규/보강/검토 대기가 몇 건 될지만 계산 (소스 순서대로 누적 반영)
      const idx = await fetchExisting();
      const keys = await loadChangeKeys();
      const nowIso = new Date().toISOString();
      for (const s of ["akei", "keoa", "showala"] as SrcName[]) {
        if (!scraped[s]) continue;
        const plan = planMerge(s, scraped[s]!, idx, keys, nowIso);
        const pending: Record<string, number> = {};
        for (const c of plan.changes) pending[c.kind] = (pending[c.kind] ?? 0) + 1;
        if (plan.toInsert.length) pending.new = plan.toInsert.length;
        wouldDo[s] = {
          insert: plan.toInsert.length, merge: plan.toUpdate.length,
          sample: [...plan.toInsert.slice(0, 3).map((e) => `신규: ${e.event_name} (${e.start_date})`), ...plan.suspectNames.slice(0, 3).map((n) => `일정 변경 의심: ${n}`)],
          pending,
        };
      }
    }
    if (!dry) {
      // 소스별로 따로 실행될 때는 서로 같은 행사를 동시에 넣어 중복되지 않도록 병합 시점을 어긋나게 함 (AKEI → KEOA → 쇼알라 순)
      const order: SrcName[] = ["akei", "keoa", "showala"];
      const notBefore = want === "all" ? 0 : { akei: 0, keoa: 50_000, showala: 85_000 }[want];
      const wait = started + notBefore - Date.now();
      if (wait > 0 && Date.now() + wait < started + 120_000) await sleep(wait);
      for (const s of order) {
        if (!scraped[s]?.length) continue;
        const r = await mergeEvents(s, scraped[s]!, new Date(started).toISOString(), truncated(s));
        inserted += r.inserted; updated += r.updated;
        for (const [k, n] of Object.entries(r.pending)) pendingTotal[k] = (pendingTotal[k] ?? 0) + n;
      }
      autoHidden = await applyKeywordFilters(noiseFilters);
      // 동시개최 묶음 — 모든 소스 병합이 끝난 마지막 소스(소스별 호출이면 쇼알라)에서 한 번 실행 (먼저 끝난 소스가 해도 다음 실행에서 보완됨)
      if (changesReady && (want === "all" || want === "showala")) {
        const ck = await loadChangeKeys();
        const c = await detectConcurrent(ck);
        if (c.asked) pendingTotal.concurrent = c.asked;
        if (c.linked) console.log(`동시개최 자동 연결 ${c.linked}건`);
      }
    }
    const elapsed = Number(((Date.now() - started) / 1000).toFixed(1));
    const errList = Object.entries(errors).map(([s, m]) => `${s}: ${m}`);
    const note = [...errList, ...warnings].join(" | ") || null;
    const ok = errList.length === 0;
    console.log(`완료 (${elapsed}s): 신규 ${inserted}, 보강 ${updated}, 비공개 ${autoHidden}, 제외 ${droppedTotal}`);

    if (!dry) {
      const row = {
        ok, source: want, elapsed_sec: elapsed, inserted, updated, auto_hidden: autoHidden, error: note,
        showala_scraped: scraped.showala?.length ?? null, keoa_scraped: scraped.keoa?.length ?? null, akei_scraped: scraped.akei?.length ?? null,
        dropped_count: droppedTotal, dropped: droppedLog, source_errors: Object.keys(errors).length ? errors : null,
      };
      let { error: logErr } = await supabase.from("scrape_logs").insert({ ...row, dropped_by_rule: droppedByRule });
      if (logErr) ({ error: logErr } = await supabase.from("scrape_logs").insert(row));   // 07_events_ui.sql 적용 전
      if (logErr) {
        // 05_events.sql 적용 전이면 기존 컬럼만으로 기록
        ({ error: logErr } = await supabase.from("scrape_logs").insert({
          ok, elapsed_sec: elapsed, inserted, updated, auto_hidden: autoHidden, error: note,
          showala_scraped: row.showala_scraped, keoa_scraped: row.keoa_scraped,
        }));
        if (logErr) console.error("scrape_logs 기록 실패:", logErr.message);
      }

      const stat = [{ name: "결과", value: `신규 ${inserted} · 보강 ${updated} · 규칙으로 제외 ${droppedTotal} · 소급 비공개 ${autoHidden}` },
        { name: "수집 건수", value: sources.map((s) => `${s} ${scraped[s]?.length ?? 0}`).join(" · ") },
        { name: "관리자 검토 대기", value: `신규 ${pendingTotal.new ?? 0} · 일정 변경 의심 ${pendingTotal.date_suspect ?? 0} · 값 변경 ${pendingTotal.field_change ?? 0} · 소스에서 사라짐 ${pendingTotal.missing ?? 0} · 동일 행사 의심 ${pendingTotal.duplicate_suspect ?? 0} · 동시개최 묶음 ${pendingTotal.concurrent ?? 0}` }];
      if (!ok) await sendAlert("error", `행사 수집 실패 (${want})`, errList.join("\n"), stat);
      else if (warnings.length) await sendAlert("warning", `행사 수집 경고 (${want})`, warnings.join("\n"), stat);
      else await sendAlert("info", `행사 수집 완료 (${want})`, `${elapsed}초 소요`, stat);
    }

    return new Response(
      JSON.stringify({ ok, dry, ...(dry ? { wouldDo } : {}), inserted, updated, autoHidden, ...(dry ? {} : { pending: pendingTotal }), dropped: droppedTotal, droppedSample: droppedLog.slice(0, 15), counts: Object.fromEntries(sources.map((s) => [s, scraped[s]?.length ?? 0])), errors, warnings, elapsed }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error("오류:", msg);
    await supabase.from("scrape_logs").insert({ ok: false, source: want, elapsed_sec: (Date.now() - started) / 1000, error: msg })
      .then(async (r: { error?: unknown }) => { if (r.error) await supabase.from("scrape_logs").insert({ ok: false, elapsed_sec: (Date.now() - started) / 1000, error: msg }); }, () => {});
    await sendAlert("error", `행사 수집 실패 (${want})`, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
