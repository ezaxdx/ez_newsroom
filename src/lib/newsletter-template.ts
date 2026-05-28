export type NewsCard = {
  title: string;
  summary: string;
  image_url: string | null;
  url: string;
};

export type EventCard = {
  name: string;
  start_date: string;
  end_date?: string | null;
  venue: string | null;
  image_url?: string | null;
  website: string | null;
};

export type NewsletterData = {
  vol_number: number;
  send_date: string;
  editorial_text: string;
  mice_news: NewsCard[];
  tourism_news: NewsCard[];
  ai_news: NewsCard[];
  ezpmp_news: NewsCard[];
  featured_events: EventCard[]; // 최대 4개
  upcoming_events: EventCard[];  // 이번 주 행사만
  site_url: string;
};

// ── 팔레트 ─────────────────────────────────────────────────
const C = {
  white:   "#FFFFFF",
  bg:      "#F5F0E8",
  green:   "#54713B",
  dark:    "#423C25",
  darkAlt: "#413C26",
  beige:   "rgba(242,234,223,0.5)",
  muted:   "#7A6E5F",
  gray:    "#D9D9D9",
  border:  "#000000",
  cream:   "#F3EBE0",
};

// ── 폰트 ───────────────────────────────────────────────────
// Noto Sans SC: wght 300(Light) / 500(Medium) / 700(Bold)
// HSSanTokki: 섹션 타이틀
// Pretendard: 푸터 저작권 (Thin)
const FONT_NOTO   = "'Noto Sans SC', 'Apple SD Gothic Neo', 'Malgun Gothic', Arial, sans-serif";
const FONT_TOKKI  = "'HSSanTokki', 'HS산토끼체', Georgia, serif";
const FONT_PRET   = "'Pretendard', 'Apple SD Gothic Neo', Arial, sans-serif";

function withUTM(url: string, vol: number): string {
  if (!url || url === "#") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=newsletter&utm_medium=email&utm_campaign=ez-letter-vol-${String(vol).padStart(2, "0")}`;
}

// ── 섹션 구분선 (선 + 큰 타이틀 + 선) ────────────────────
function sectionDivider(title: string): string {
  return `
<tr>
  <td style="background:${C.white};padding:28px 32px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="border-top:1px solid ${C.border};font-size:0;line-height:0;padding:0;">&nbsp;</td>
        <td style="text-align:center;white-space:nowrap;padding:0 20px;width:1%;">
          <span style="font-size:48px;font-weight:400;color:${C.dark};font-family:${FONT_TOKKI};letter-spacing:0;">${title}</span>
        </td>
        <td style="border-top:1px solid ${C.border};font-size:0;line-height:0;padding:0;">&nbsp;</td>
      </tr>
    </table>
  </td>
</tr>`;
}

// ── 뉴스 카드 (이메일용 테이블 기반) ─────────────────────
function newsCard(item: NewsCard, vol: number): string {
  const img = item.image_url
    ? `<img src="${item.image_url}" alt="" width="255" height="129"
           style="display:block;width:255px;height:129px;object-fit:cover;">`
    : `<div style="width:255px;height:129px;background:${C.gray};display:table-cell;vertical-align:middle;text-align:center;">
         <span style="font-size:24px;font-family:${FONT_NOTO};">사진</span>
       </div>`;
  const summary = item.summary.length > 60 ? item.summary.slice(0, 60) + "…" : item.summary;
  return `
<td width="255" valign="top">
  <a href="${withUTM(item.url, vol)}" style="text-decoration:none;color:inherit;display:block;">
    <table cellpadding="0" cellspacing="0" width="255">
      <tr><td style="line-height:0;font-size:0;">${img}</td></tr>
      <tr><td style="padding:8px 4px 0;">
        <p style="margin:0 0 6px;font-size:16px;font-weight:500;color:#000000;line-height:1.3;text-align:center;font-family:${FONT_NOTO};">${item.title}</p>
        <p style="margin:0;font-size:13px;font-weight:300;color:#000000;line-height:1.5;text-align:center;font-family:${FONT_NOTO};">${summary}</p>
      </td></tr>
    </table>
  </a>
</td>`;
}

// ── Pick 행사 카드 ────────────────────────────────────────
function pickCard(ev: EventCard, vol: number, site_url: string): string {
  const img = ev.image_url
    ? `<img src="${ev.image_url}" alt="" width="255" height="129"
           style="display:block;width:255px;height:129px;object-fit:cover;">`
    : `<div style="width:255px;height:129px;background:${C.gray};display:table-cell;vertical-align:middle;text-align:center;">
         <span style="font-size:24px;font-family:${FONT_NOTO};">사진</span>
       </div>`;
  const link = withUTM(ev.website ?? site_url, vol);
  const dateVenue = ev.venue ? `${ev.start_date} · ${ev.venue}` : ev.start_date;
  return `
<td width="255" valign="top">
  <a href="${link}" style="text-decoration:none;color:inherit;display:block;">
    <table cellpadding="0" cellspacing="0" width="255">
      <tr><td style="line-height:0;font-size:0;">${img}</td></tr>
      <tr><td style="padding:8px 4px 0;">
        <p style="margin:0 0 6px;font-size:16px;font-weight:500;color:#000000;line-height:1.3;text-align:center;font-family:${FONT_NOTO};">${ev.name}</p>
        <p style="margin:0;font-size:13px;font-weight:300;color:#000000;line-height:1.5;text-align:center;font-family:${FONT_NOTO};">${dateVenue}</p>
      </td></tr>
    </table>
  </a>
</td>`;
}

// ── 행사 리스트 행 (시작일~종료일 + 행사명 링크) ──────
function eventRow(ev: EventCard, vol: number, site_url: string, isLast: boolean): string {
  const link = withUTM(ev.website ?? site_url, vol);
  const border = isLast ? "" : `border-bottom:1px solid #E8E0D0;`;
  const dateRange = ev.end_date && ev.end_date !== ev.start_date
    ? `${ev.start_date}&nbsp;~&nbsp;${ev.end_date}`
    : ev.start_date;
  return `
<tr>
  <td style="padding:9px 0;${border}width:160px;font-size:12px;font-weight:700;color:${C.green};white-space:nowrap;vertical-align:middle;font-family:${FONT_NOTO};">${dateRange}</td>
  <td style="padding:9px 8px;${border}font-size:13px;font-weight:500;color:${C.dark};vertical-align:middle;font-family:${FONT_NOTO};">
    <a href="${link}" style="color:${C.dark};text-decoration:underline;font-family:${FONT_NOTO};">${ev.name}</a>
  </td>
</tr>`;
}

// ── 뉴스 카테고리 블록 ────────────────────────────────────
function newsSection(label: string, items: NewsCard[], vol: number): string {
  if (items.length === 0) return "";
  const cards = items.slice(0, 2).map(n => newsCard(n, vol)).join(`<td width="22"></td>`);
  return `
<tr>
  <td style="background:${C.white};padding:0 32px 24px;">
    <p style="margin:0 0 14px;font-size:16px;font-weight:500;color:#000000;font-family:${FONT_NOTO};">- ${label}</p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>${cards}</tr>
    </table>
  </td>
</tr>`;
}

// ── 메인 HTML ──────────────────────────────────────────────
export function generateNewsletterHTML(data: NewsletterData): string {
  const { vol_number: vol, send_date, editorial_text,
          mice_news, tourism_news, ai_news, ezpmp_news,
          featured_events, upcoming_events, site_url } = data;

  // Pick 4개 → 2행
  const picks = featured_events.slice(0, 4);
  const pickRow1 = picks.slice(0, 2).map(e => pickCard(e, vol, site_url)).join(`<td width="22"></td>`);
  const pickRow2 = picks.slice(2, 4).map(e => pickCard(e, vol, site_url)).join(`<td width="22"></td>`);

  // 행사 리스트
  const listRows = upcoming_events.map((ev, i) =>
    eventRow(ev, vol, site_url, i === upcoming_events.length - 1)
  ).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>[EZ Letter] Vol.${String(vol).padStart(2,"0")} · ${send_date}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap');
@import url('https://cdn.jsdelivr.net/gh/fonts-archive/HSSanTokki/HSSanTokki.css');
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT_NOTO};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 0 40px;">

  <table width="600" cellpadding="0" cellspacing="0" border="0"
         style="max-width:600px;width:100%;background:${C.white};">

    <!-- ── HEADER IMAGE (배경) + Vol./Date 텍스트 (이미지 내부 상단에 오버레이) ── -->
    <tr>
      <td style="background-image:url('${site_url}/images/ez-letter-header.png');background-size:100% auto;background-repeat:no-repeat;background-color:${C.bg};height:486px;padding:22px 0 0;text-align:center;vertical-align:top;">
        <p style="margin:0;font-size:16px;font-weight:500;color:${C.darkAlt};font-family:${FONT_NOTO};">
          Vol.${String(vol).padStart(2,"0")} &nbsp;·&nbsp; ${send_date}
        </p>
      </td>
    </tr>

    <!-- ── EDITORIAL (베이지 박스) ── -->
    <tr>
      <td style="background:${C.white};padding:24px 20px;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="background:rgba(242,234,223,0.5);border-radius:15px;padding:24px 28px;">
              <p style="margin:0;font-size:15px;font-weight:500;color:#000000;line-height:1.85;text-align:center;white-space:pre-line;font-family:${FONT_NOTO};">${editorial_text || "이번 호 인사말이 없습니다."}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── NEWS 섹션 구분선 ── -->
    ${sectionDivider("News")}

    <!-- MICE / Tourism / AI / EZPMP 뉴스 (없으면 섹션 자동 제거) -->
    ${newsSection("MICE", mice_news, vol)}
    ${newsSection("Tourism", tourism_news, vol)}
    ${newsSection("AI", ai_news, vol)}
    ${newsSection("EZPMP", ezpmp_news, vol)}

    <!-- ── EZ LETTER PICK 섹션 구분선 ── -->
    ${sectionDivider("ez letter Pick !")}

    <!-- ── PICK 행사 4개 (2×2) ── -->
    <tr>
      <td style="background:${C.white};padding:0 32px 24px;">
        <table cellpadding="0" cellspacing="0" width="100%">
          ${pickRow1 ? `<tr>${pickRow1}</tr>` : ""}
          ${pickRow2 ? `
            <tr><td colspan="3" height="20" style="font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>${pickRow2}</tr>
          ` : ""}
          ${!pickRow1 ? `<tr><td style="font-size:13px;font-weight:300;color:${C.muted};padding:8px 0;text-align:center;font-family:${FONT_NOTO};">이번 주 추천 행사가 없습니다.</td></tr>` : ""}
        </table>
      </td>
    </tr>

    <!-- ── WEEKLY EVENT LIST 섹션 구분선 ── -->
    ${sectionDivider("Weekly Event List")}

    <!-- ── 행사 리스트 ── -->
    <tr>
      <td style="background:${C.white};padding:0 32px 32px;">
        <table cellpadding="0" cellspacing="0" width="100%">
          ${listRows || `<tr><td style="font-size:13px;font-weight:300;color:${C.muted};padding:12px 0;text-align:center;font-family:${FONT_NOTO};">예정된 행사가 없습니다.</td></tr>`}
        </table>
      </td>
    </tr>

    <!-- ── FOOTER ── -->
    <tr>
      <td style="background:${C.white};border-top:1px solid ${C.border};padding:28px 32px 40px;text-align:center;">
        <img src="${site_url}/images/ez-letter-logo.png" width="80" alt="EZ Letter"
             style="display:inline-block;max-width:80px;height:auto;margin-bottom:14px;">
        <p style="margin:0 0 8px;font-size:16px;font-weight:500;color:${C.dark};font-family:${FONT_NOTO};">
          <a href="${withUTM(site_url, vol)}" style="color:${C.dark};text-decoration:underline;font-family:${FONT_NOTO};">EZ 뉴스룸 바로가기</a>
        </p>
        <p style="margin:0;font-size:15px;font-weight:100;color:#000000;font-family:${FONT_PRET};">© AXDX All Rights Reserved.</p>
        <p style="margin:6px 0 0;font-size:11px;color:#BBBBBB;font-family:${FONT_NOTO};">
          수신 거부: <a href="mailto:ez.micedx1@gmail.com" style="color:#BBBBBB;font-family:${FONT_NOTO};">ez.micedx1@gmail.com</a>
        </p>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}
