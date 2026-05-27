/**
 * Supabase Edge Function: naver-rss-proxy
 * 네이버 블로그 RSS를 브라우저 헤더로 우회 수집 후 그대로 반환
 *
 * 호출: GET {SUPABASE_URL}/functions/v1/naver-rss-proxy?blogId=ezpmpofficial
 * 인증: ?secret={CRON_SECRET} (쿼리 파라미터)
 */

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// 브라우저처럼 위장하는 헤더 세트
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://blog.naver.com/",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const blogId = url.searchParams.get("blogId");
  const secret = url.searchParams.get("secret");

  // 인증 확인
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!blogId) {
    return new Response("blogId 파라미터가 필요합니다", { status: 400 });
  }

  const rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;

  try {
    const res = await fetch(rssUrl, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response(
        `네이버 RSS 응답 오류: ${res.status} ${res.statusText}`,
        { status: res.status }
      );
    }

    const content = await res.text();

    // 네이버가 RSS 대신 HTML 로그인 페이지 반환하는 경우 감지
    if (content.includes("<html") && !content.includes("<rss")) {
      return new Response(
        JSON.stringify({
          error: "RSS 접근 차단됨 — 네이버가 HTML 페이지를 반환했습니다",
          blogId,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(content, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message, blogId }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
