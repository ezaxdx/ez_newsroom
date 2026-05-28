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
  featured_events: EventCard[];
  upcoming_events: EventCard[];
  site_url: string;
};

function withUTM(url: string, vol: number): string {
  if (!url || url === "#") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=newsletter&utm_medium=email&utm_campaign=ez-letter-vol-${String(vol).padStart(2, "0")}`;
}

function newsCardHTML(card: NewsCard, vol_number: number): string {
  const imgBlock = card.image_url
    ? `<img src="${card.image_url}" alt="" width="260" height="150" style="display:block;width:100%;height:150px;object-fit:cover;border-radius:6px 6px 0 0;">`
    : `<div style="width:100%;height:150px;background:#3D5A2E;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:center;">
        <span style="color:#fff;font-size:24px;">📰</span>
       </div>`;
  const shortSummary = card.summary.length > 80 ? card.summary.slice(0, 80) + "…" : card.summary;
  return `
  <td width="260" valign="top" style="padding:0 6px;">
    <a href="${withUTM(card.url, vol_number)}" style="text-decoration:none;color:inherit;">
      <div style="background:#fff;border-radius:8px;overflow:hidden;border:1px solid #E0D9CE;">
        ${imgBlock}
        <div style="padding:12px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#2C2416;line-height:1.4;">${card.title}</p>
          <p style="margin:0;font-size:12px;color:#6B5E4E;line-height:1.5;">${shortSummary}</p>
        </div>
      </div>
    </a>
  </td>`;
}

function featuredEventHTML(ev: EventCard, vol_number: number, site_url: string): string {
  const imgBlock = ev.image_url
    ? `<img src="${ev.image_url}" alt="" width="260" height="120" style="display:block;width:100%;height:120px;object-fit:cover;border-radius:6px 6px 0 0;">`
    : `<div style="width:100%;height:120px;background:#3D5A2E;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:center;">
        <span style="color:#fff;font-size:20px;font-weight:700;">📅</span>
       </div>`;
  const link = withUTM(ev.website ?? site_url, vol_number);
  return `
  <td width="260" valign="top" style="padding:0 6px;">
    <a href="${link}" style="text-decoration:none;color:inherit;">
      <div style="background:#fff;border-radius:8px;overflow:hidden;border:1px solid #E0D9CE;">
        ${imgBlock}
        <div style="padding:12px;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#2C2416;line-height:1.4;">${ev.name}</p>
          <p style="margin:0;font-size:12px;color:#3D5A2E;font-weight:600;">${ev.start_date}${ev.venue ? " · " + ev.venue : ""}</p>
        </div>
      </div>
    </a>
  </td>`;
}

function upcomingEventRow(ev: EventCard, vol_number: number, site_url: string): string {
  const link = withUTM(ev.website ?? site_url, vol_number);
  return `
  <tr>
    <td style="padding:8px 12px;font-size:12px;color:#3D5A2E;font-weight:600;white-space:nowrap;border-bottom:1px solid #F0EBE0;">${ev.start_date}</td>
    <td style="padding:8px 12px;font-size:12px;color:#2C2416;border-bottom:1px solid #F0EBE0;">
      <a href="${link}" style="color:#2C2416;text-decoration:none;">${ev.name}</a>
    </td>
    <td style="padding:8px 12px;font-size:12px;color:#6B5E4E;border-bottom:1px solid #F0EBE0;">${ev.venue ?? "-"}</td>
  </tr>`;
}

export function generateNewsletterHTML(data: NewsletterData): string {
  const {
    vol_number,
    send_date,
    editorial_text,
    mice_news,
    tourism_news,
    featured_events,
    upcoming_events,
    site_url,
  } = data;

  const newsCard = (card: NewsCard) => newsCardHTML(card, vol_number);
  const eventCard = (ev: EventCard) => featuredEventHTML(ev, vol_number, site_url);
  const eventRow = (ev: EventCard) => upcomingEventRow(ev, vol_number, site_url);

  const miceCards = mice_news
    .slice(0, 2)
    .map(newsCard)
    .join("");

  const tourismCards = tourism_news
    .slice(0, 2)
    .map(newsCard)
    .join("");

  const featuredCells = featured_events
    .slice(0, 2)
    .map(eventCard)
    .join("");

  const upcomingRows = upcoming_events
    .map(eventRow)
    .join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>[EZ Letter] Vol.${vol_number} · ${send_date}</title>
</head>
<body style="margin:0;padding:0;background:#E8E3D9;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E8E3D9;">
  <tr>
    <td align="center" style="padding:24px 0;">
      <!-- WRAPPER -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- ── HEADER ── -->
        <tr>
          <td style="background:#F5F0E8;border-radius:12px 12px 0 0;padding:28px 32px 20px;text-align:center;border:1px solid #E0D9CE;border-bottom:none;">
            <p style="margin:0 0 12px;font-size:12px;color:#6B5E4E;letter-spacing:0.05em;">Vol.${vol_number} &nbsp;·&nbsp; ${send_date}</p>
            <img src="${site_url}/images/ez-letter-logo.png" width="280" alt="EZ Letter" style="display:inline-block;max-width:280px;height:auto;">
            <p style="margin:14px 0 0;font-size:13px;color:#3D5A2E;font-weight:600;letter-spacing:0.02em;">업계 이야기를 쉽고 빠르게 읽는 EZ 인사이트</p>
          </td>
        </tr>

        <!-- ── TAG BAR ── -->
        <tr>
          <td style="background:#3D5A2E;padding:10px 32px;text-align:center;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <span style="color:#fff;font-size:12px;font-weight:600;margin:0 8px;">#MICE</span>
            <span style="color:#fff;font-size:12px;font-weight:600;margin:0 8px;">#TOURISM</span>
            <span style="color:#fff;font-size:12px;font-weight:600;margin:0 8px;">#AI</span>
            <span style="color:#fff;font-size:12px;font-weight:600;margin:0 8px;">#Short Topic</span>
          </td>
        </tr>

        <!-- ── EDITORIAL ── -->
        <tr>
          <td style="background:#fff;padding:24px 32px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <p style="margin:0;font-size:14px;color:#2C2416;line-height:1.8;white-space:pre-line;">${editorial_text}</p>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="background:#fff;padding:0 32px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <div style="height:1px;background:#E8E3D9;"></div>
          </td>
        </tr>

        <!-- ── MICE NEWS ── -->
        <tr>
          <td style="background:#fff;padding:24px 32px 16px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <span style="display:inline-block;background:#3D5A2E;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:0.06em;margin-bottom:14px;">MICE</span>
                </td>
              </tr>
              <tr>
                ${miceCards || `<td style="font-size:13px;color:#6B5E4E;padding:8px 0;">이번 주 MICE 뉴스가 없습니다.</td>`}
              </tr>
            </table>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="background:#fff;padding:0 32px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <div style="height:1px;background:#E8E3D9;"></div>
          </td>
        </tr>

        <!-- ── TOURISM NEWS ── -->
        <tr>
          <td style="background:#fff;padding:24px 32px 16px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <span style="display:inline-block;background:#5A7A3D;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:0.06em;margin-bottom:14px;">TOURISM</span>
                </td>
              </tr>
              <tr>
                ${tourismCards || `<td style="font-size:13px;color:#6B5E4E;padding:8px 0;">이번 주 Tourism 뉴스가 없습니다.</td>`}
              </tr>
            </table>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="background:#fff;padding:0 32px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <div style="height:1px;background:#E8E3D9;"></div>
          </td>
        </tr>

        <!-- ── FEATURED EVENTS ── -->
        <tr>
          <td style="background:#fff;padding:24px 32px 16px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#2C2416;">📌 EZ Letter Pick! 이번 주 행사</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${featuredCells || `<td style="font-size:13px;color:#6B5E4E;padding:8px 0;">이번 주 추천 행사가 없습니다.</td>`}
              </tr>
            </table>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="background:#fff;padding:0 32px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <div style="height:1px;background:#E8E3D9;"></div>
          </td>
        </tr>

        <!-- ── UPCOMING EVENTS ── -->
        <tr>
          <td style="background:#fff;padding:24px 32px;border-left:1px solid #E0D9CE;border-right:1px solid #E0D9CE;">
            <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#2C2416;">📅 이번 주 행사 리스트</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:8px;overflow:hidden;border:1px solid #E0D9CE;">
              <tr style="background:#F5F0E8;">
                <th style="padding:8px 12px;font-size:12px;color:#6B5E4E;text-align:left;font-weight:600;border-bottom:1px solid #E0D9CE;">날짜</th>
                <th style="padding:8px 12px;font-size:12px;color:#6B5E4E;text-align:left;font-weight:600;border-bottom:1px solid #E0D9CE;">행사명</th>
                <th style="padding:8px 12px;font-size:12px;color:#6B5E4E;text-align:left;font-weight:600;border-bottom:1px solid #E0D9CE;">장소</th>
              </tr>
              ${upcomingRows || `<tr><td colspan="3" style="padding:12px;font-size:13px;color:#6B5E4E;text-align:center;">예정된 행사가 없습니다.</td></tr>`}
            </table>
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style="background:#3D5A2E;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;border:1px solid #2E4422;border-top:none;">
            <p style="margin:0 0 8px;">
              <a href="${withUTM(site_url, vol_number)}" style="color:#A8C490;font-size:13px;font-weight:600;text-decoration:none;">EZ 뉴스룸 바로가기 →</a>
            </p>
            <p style="margin:0 0 6px;font-size:11px;color:#7A9E62;">Copyright © 2026 AXDX All rights reserved.</p>
            <p style="margin:0;font-size:11px;color:#7A9E62;">수신 거부 문의: <a href="mailto:ez.micedx1@gmail.com" style="color:#7A9E62;">ez.micedx1@gmail.com</a></p>
          </td>
        </tr>

      </table>
      <!-- /WRAPPER -->
    </td>
  </tr>
</table>
</body>
</html>`;
}
