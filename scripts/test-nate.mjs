const res = await fetch('https://news.nate.com/view/20260528n08972', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer': 'https://www.google.com/',
  },
  redirect: 'follow'
});

const ct = res.headers.get('content-type') ?? '';
console.log('Content-Type:', ct);

const buf = await res.arrayBuffer();
const charset = ct.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8';
const encName = ['euc-kr','ks_c_5601-1987','cp949','x-windows-949'].includes(charset) ? 'euc-kr' : 'utf-8';
console.log('charset 감지:', charset, '→ decoder:', encName);

const html = new TextDecoder(encName).decode(buf);

// og:image
const og1 = html.match(/property="og:image"[^>]+content="([^"]+)"/i)?.[1];
const og2 = html.match(/content="([^"]+)"[^>]+property="og:image"/i)?.[1];
const tw  = html.match(/name="twitter:image"[^>]+content="([^"]+)"/i)?.[1];

console.log('og:image:', og1 ?? og2 ?? '없음');
console.log('twitter:image:', tw ?? '없음');

// 본문 텍스트
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 500);
console.log('\n본문 미리보기:\n', text);
