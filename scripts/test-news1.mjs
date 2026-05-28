// og-image/route.ts의 실제 로직을 그대로 복사해서 테스트
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Referer": "https://www.google.com/",
};

function extractImage(html, baseUrl) {
  const ogMatch =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

  const twitterMatch =
    html.match(/name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

  const naverImgMatch =
    html.match(/src="(https:\/\/blogfiles\.pstatic\.net[^"]+)"/i) ??
    html.match(/data-lazy-src="(https:\/\/postfiles\.pstatic\.net[^"]+)"/i);

  const rawImage = ogMatch?.[1] ?? twitterMatch?.[1] ?? naverImgMatch?.[1] ?? null;
  console.log('ogMatch:', ogMatch?.[1] ?? '없음');
  console.log('twitterMatch:', twitterMatch?.[1] ?? '없음');

  if (!rawImage) return null;
  try {
    return new URL(rawImage, baseUrl).href;
  } catch {
    return rawImage;
  }
}

// 테스트 URL 목록
const urls = [
  'https://www.news1.kr/local/daegu-gyeongbuk/6179702',
  'https://news.nate.com/view/20260528n08972',
];

for (const url of urls) {
  console.log('\n' + '='.repeat(60));
  console.log('URL:', url);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
    const ct = res.headers.get('content-type') ?? '';
    const charset = ct.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8';
    const encName = ['euc-kr','ks_c_5601-1987','cp949','x-windows-949'].includes(charset) ? 'euc-kr' : 'utf-8';

    let html;
    if (encName === 'utf-8') {
      html = await res.text();
    } else {
      const buf = await res.arrayBuffer();
      html = new TextDecoder(encName).decode(buf);
    }

    const image = extractImage(html, url);
    console.log('→ 최종 이미지 URL:', image ?? '❌ 없음');
  } catch(e) {
    console.log('→ 오류:', e.message);
  }
}
