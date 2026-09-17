/**
 * 언론사 자체 Next.js 이미지 리사이저(/_next/image?url=...)는 클라우드(Vercel) IP를
 * 차단하는 경우가 있음(news1.kr에서 실제 확인 — 원본 서버는 정상 응답하는데 리사이저만
 * 막힘). 이런 URL이면 안에 감싸인 원본 이미지 URL을 꺼내 그쪽을 먼저 시도하도록 함.
 * 리사이저 URL이 아니면 null 반환.
 */
export function unwrapNextImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.endsWith("/_next/image")) return null;
  const inner = parsed.searchParams.get("url");
  if (!inner) return null;
  try {
    const innerParsed = new URL(inner, parsed.origin);
    if (innerParsed.protocol !== "http:" && innerParsed.protocol !== "https:") return null;
    return innerParsed.toString();
  } catch {
    return null;
  }
}
