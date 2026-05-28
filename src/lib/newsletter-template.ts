export type NewsCard = {
  title: string;
  summary: string;
  image_url: string | null;
  url: string;
};

export type EventCard = {
  name: string;
  start_date: string;
  venue: string | null;
  image_url?: string | null;
  website: string | null;
};

export type NewsletterData = {
  vol_number: number;
  send_date: string; // "2026.05.28"
  editorial_text: string;
  mice_news: NewsCard[];
  tourism_news: NewsCard[];
  featured_events: EventCard[]; // 최대 4개
  upcoming_events: EventCard[];
  site_url: string;
};

// ── 색상 팔레트 (EZ Letter 로고 기준) ──────────────────────────
const C = {
  bg:       "#F5F0E8",  // 크림 베이지
  surface:  "#FFFFFF",
  green:    "#50723C",  // 진한 초록
  dark:     "#423E28",  // 다크 브라운
  muted:    "#7A6E5F",  // 중간 톤
  border:   "#DDD5C4",  // 연한 베이지 보더
  dashLine: "#C8BEA8",  // 대시 라인
};

function withUTM(url: string, vol: number): string {
  if (!url || url === "#") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=newsletter&utm_medium=email&utm_campaign=ez-letter-vol-${String(vol).padStart(2, "0")}`;
}

// ── 섹션 헤더 (대시 라인 + 레이블) ────────────────────────────
function sectionHeader(label: string, sub: string): string {
  return `
<tr>
  <td style="background:${C.bg};padding:24px 32px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="border-top:2px dashed ${C.dashLine};padding-top:14px;padding-bottom:10px;">
          <span style="font-size:15px;font-weight:900;color:${C.dark};letter-spacing:-0.02em;font-family:'Arial Black',sans-serif;">${label}</span>
          <span style="font-size:14px;font-weight:400;color:${C.dark};margin-left:8px;">${sub}</span>
        </td>
      </tr>
      <tr>
        <td style="border-bottom:2px dashed ${C.dashLine};padding-bottom:16px;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>
  </td>
</tr>`;
}

// ── 뉴스 카드 ─────────────────────────────────────────────────
function newsCardHTML(card: NewsCard, vol: number): string {
  const img = card.image_url
    ? `<img src="${card.image_url}" alt="" width="255" height="145" style="display:block;width:255px;height:145px;object-fit:cover;border-radius:8px 8px 0 0;">`
    : `<div style="width:255px;height:145px;background:${C.green};border-radius:8px 8px 0 0;text-align:center;padding-top:52px;">
        <span style="color:#fff;font-size:28px;">📰</span>
       </div>`;
  const summary = card.summary.length > 75 ? card.summary.slice(0, 75) + "…" : card.summary;
  return `
<td width="255" valign="top">
  <a href="${withUTM(card.url, vol)}" style="text-decoration:none;color:inherit;display:block;">
    <table cellpadding="0" cellspacing="0" width="255" style="border-radius:8px;overflow:hidden;border:1px solid ${C.border};background:${C.surface};">
      <tr><td style="padding:0;line-height:0;">${img}</td></tr>
      <tr><td style="padding:12px 14px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${C.dark};line-height:1.45;">${card.title}</p>
        <p style="margin:0;font-size:11.5px;color:${C.muted};line-height:1.55;">${summary}</p>
      </td></tr>
    </table>
  </a>
</td>`;
}

// ── Pick 행사 카드 (2×2) ────────────────────────────────────
function pickEventCard(ev: EventCard, vol: number, site_url: string): string {
  const img = ev.image_url
    ? `<img src="${ev.image_url}" alt="" width="255" height="140" style="display:block;width:255px;height:140px;object-fit:cover;border-radius:8px 8px 0 0;">`
    : `<div style="width:255px;height:140px;background:${C.green};border-radius:8px 8px 0 0;text-align:center;padding-top:46px;">
        <span style="color:#F5F0E8;font-size:13px;font-weight:700;letter-spacing:0.04em;">EZ LETTER</span>
       </div>`;
  const link = withUTM(ev.website ?? site_url, vol);
  return `
<td width="255" valign="top">
  <a href="${link}" style="text-decoration:none;color:inherit;display:block;">
    <table cellpadding="0" cellspacing="0" width="255" style="border-radius:8px;overflow:hidden;border:1px solid ${C.border};background:${C.surface};">
      <tr><td style="padding:0;line-height:0;">${img}</td></tr>
      <tr><td style="padding:12px 14px;">
        <p style="margin:0 0 5px;font-size:13px;font-weight:700;color:${C.dark};line-height:1.4;">${ev.name}</p>
        <p style="margin:0;font-size:11.5px;color:${C.green};font-weight:600;">${ev.start_date}${ev.venue ? " · " + ev.venue : ""}</p>
      </td></tr>
    </table>
  </a>
</td>`;
}

// ── 행사 리스트 행 ─────────────────────────────────────────
function eventListRow(ev: EventCard, vol: number, site_url: string, isLast: boolean): string {
  const link = withUTM(ev.website ?? site_url, vol);
  const border = isLast ? "" : `border-bottom:1px solid ${C.border};`;
  return `
<tr>
  <td style="padding:9px 0;${border}width:95px;font-size:12px;font-weight:600;color:${C.green};white-space:nowrap;vertical-align:top;">${ev.start_date}</td>
  <td style="padding:9px 8px;${border}font-size:12.5px;color:${C.dark};vertical-align:top;">
    <a href="${link}" style="color:${C.dark};text-decoration:none;">${ev.name}</a>
  </td>
  <td style="padding:9px 0;${border}font-size:12px;color:${C.muted};white-space:nowrap;text-align:right;vertical-align:top;">${ev.venue ?? ""}</td>
</tr>`;
}

// ── 메인 HTML 생성 ──────────────────────────────────────────
export function generateNewsletterHTML(data: NewsletterData): string {
  const { vol_number, send_date, editorial_text,
          mice_news, tourism_news, featured_events, upcoming_events, site_url } = data;

  const vol = vol_number;

  // 뉴스 카드
  const miceCards   = mice_news.slice(0, 2).map(c => newsCardHTML(c, vol)).join(`<td width="20"></td>`);
  const tourismCards = tourism_news.slice(0, 2).map(c => newsCardHTML(c, vol)).join(`<td width="20"></td>`);

  // Pick 행사 4개 → 2행 2열
  const pickSlice = featured_events.slice(0, 4);
  const pickRow1  = pickSlice.slice(0, 2).map(e => pickEventCard(e, vol, site_url)).join(`<td width="20"></td>`);
  const pickRow2  = pickSlice.slice(2, 4).map(e => pickEventCard(e, vol, site_url)).join(`<td width="20"></td>`);

  // 행사 리스트
  const listRows = upcoming_events.map((ev, i) =>
    eventListRow(ev, vol, site_url, i === upcoming_events.length - 1)
  ).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>[EZ Letter] Vol.${String(vol).padStart(2,"0")} · ${send_date}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 0 40px;">

  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

    <!-- ── HEADER ── -->
    <tr>
      <td style="background:${C.bg};border-radius:16px 16px 0 0;padding:28px 32px 0;text-align:center;">
        <p style="margin:0 0 14px;font-size:11.5px;color:${C.muted};letter-spacing:0.08em;text-transform:uppercase;">
          Vol.${String(vol).padStart(2,"0")} &nbsp;·&nbsp; ${send_date}
        </p>
        <img src="${site_url}/images/ez-letter-logo.png" width="200" alt="EZ Letter"
             style="display:inline-block;max-width:200px;height:auto;">
        <p style="margin:16px 0 0;font-size:13px;color:${C.dark};font-weight:600;letter-spacing:0.01em;">
          업계 이야기를 쉽고 빠르게 읽는 EZ 인사이트
        </p>
      </td>
    </tr>

    <!-- ── TAG BAR ── -->
    <tr>
      <td style="background:${C.green};padding:11px 32px;text-align:center;margin-top:18px;">
        <span style="color:#F5F0E8;font-size:12px;font-weight:700;margin:0 10px;letter-spacing:0.04em;">#MICE</span>
        <span style="color:#F5F0E8;font-size:12px;font-weight:700;margin:0 10px;letter-spacing:0.04em;">#TOURISM</span>
        <span style="color:#F5F0E8;font-size:12px;font-weight:700;margin:0 10px;letter-spacing:0.04em;">#AI</span>
        <span style="color:#F5F0E8;font-size:12px;font-weight:700;margin:0 10px;letter-spacing:0.04em;">#Short Topic</span>
      </td>
    </tr>

    <!-- ── EDITORIAL ── -->
    <tr>
      <td style="background:${C.bg};padding:24px 32px 8px;">
        <p style="margin:0;font-size:14px;color:${C.dark};line-height:1.85;white-space:pre-line;">${editorial_text}</p>
      </td>
    </tr>

    <!-- ── NEWS 섹션 헤더 ── -->
    ${sectionHeader("NEWS", "지금 뜨거운 이슈")}

    <!-- ── MICE 뉴스 ── -->
    <tr>
      <td style="background:${C.bg};padding:16px 32px 8px;">
        <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:${C.green};text-transform:uppercase;letter-spacing:0.1em;">MICE</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            ${miceCards || `<td style="font-size:13px;color:${C.muted};">이번 주 MICE 뉴스가 없습니다.</td>`}
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── Tourism 뉴스 ── -->
    <tr>
      <td style="background:${C.bg};padding:16px 32px 8px;">
        <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:${C.green};text-transform:uppercase;letter-spacing:0.1em;">TOURISM</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            ${tourismCards || `<td style="font-size:13px;color:${C.muted};">이번 주 Tourism 뉴스가 없습니다.</td>`}
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── EZ LETTER PICK 섹션 헤더 ── -->
    ${sectionHeader("EZ Letter Pick!", "이번주 행사")}

    <!-- ── PICK 행사 4개 (2×2) ── -->
    <tr>
      <td style="background:${C.bg};padding:16px 32px 0;">
        <table cellpadding="0" cellspacing="0" width="100%">
          ${pickRow1 ? `<tr>${pickRow1}</tr>` : ""}
          ${pickRow2 ? `<tr><td colspan="3" height="14" style="font-size:0;line-height:0;">&nbsp;</td></tr><tr>${pickRow2}</tr>` : ""}
          ${!pickRow1 ? `<tr><td style="font-size:13px;color:${C.muted};padding:8px 0;">이번 주 추천 행사가 없습니다.</td></tr>` : ""}
        </table>
      </td>
    </tr>

    <!-- ── 이번주 행사 리스트 섹션 헤더 ── -->
    ${sectionHeader("이번주 행사", "빠르게 훑어보기")}

    <!-- ── 행사 리스트 ── -->
    <tr>
      <td style="background:${C.bg};padding:16px 32px 8px;">
        <table cellpadding="0" cellspacing="0" width="100%">
          ${listRows || `<tr><td style="font-size:13px;color:${C.muted};padding:8px 0;">예정된 행사가 없습니다.</td></tr>`}
        </table>
      </td>
    </tr>

    <!-- 하단 여백 -->
    <tr><td style="background:${C.bg};height:20px;font-size:0;line-height:0;">&nbsp;</td></tr>

    <!-- ── FOOTER ── -->
    <tr>
      <td style="background:${C.green};border-radius:0 0 16px 16px;padding:22px 32px;text-align:center;">
        <p style="margin:0 0 10px;">
          <a href="${withUTM(site_url, vol)}"
             style="color:#F5F0E8;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.02em;">
            EZ 뉴스룸 바로가기 →
          </a>
        </p>
        <p style="margin:0 0 5px;font-size:11px;color:rgba(245,240,232,0.6);">
          Copyright © 2026 AXDX All rights reserved.
        </p>
        <p style="margin:0;font-size:11px;color:rgba(245,240,232,0.5);">
          수신 거부 문의:
          <a href="mailto:ez.micedx1@gmail.com" style="color:rgba(245,240,232,0.5);">ez.micedx1@gmail.com</a>
        </p>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}
