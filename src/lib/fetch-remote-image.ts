import sharp from "sharp";
import { unwrapNextImageUrl } from "@/lib/unwrap-image-url";

const MAX_BYTES = 5 * 1024 * 1024;

/** 본문 수신까지 제한 시간에 포함하고, 실제로 해독한 사진만 카드용 JPG로 반환한다. */
export async function fetchRemoteImage(url: string, timeoutMs = 12000, articleUrl?: string): Promise<Buffer | null> {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;

  let articleReferer: string | undefined;
  try {
    const article = new URL(articleUrl ?? "");
    if (/^https?:$/.test(article.protocol)) articleReferer = article.href;
  } catch { /* 원문 주소가 없으면 이미지 도메인을 사용 */ }

  const original = parsed.href;
  const unwrapped = unwrapNextImageUrl(original);
  const candidates = unwrapped ? [unwrapped, original] : [original];
  const deadline = Date.now() + timeoutMs;

  // 원본·리사이저 및 재시도가 하나의 시간 예산을 공유한다.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const candidate of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      try {
        const response = await fetch(candidate, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": attempt === 0 && articleReferer ? articleReferer : `${new URL(candidate).origin}/`,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(Math.min(4000, remaining)),
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !/^(image\/|application\/octet-stream)/i.test(contentType) ||
            Number(response.headers.get("content-length")) > MAX_BYTES) {
          void response.body?.cancel().catch(() => {});
          console.warn("[newsletter-image] rejected response", new URL(candidate).hostname, response.status, contentType);
          continue;
        }
        const reader = response.body?.getReader();
        if (!reader) continue;
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error("image exceeds 5MB");
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (Date.now() >= deadline) return null;
        const image = sharp(Buffer.concat(chunks), { limitInputPixels: 20_000_000, failOn: "warning" });
        const metadata = await image.metadata();
        if (!metadata.format || !["jpeg", "png", "webp", "gif", "heif", "avif"].includes(metadata.format) ||
            (metadata.width ?? 0) < 5 || (metadata.height ?? 0) < 5) continue;
        // 비율을 유지한 채 중앙을 잘라 카드 전체를 채운다. 이메일의 object-fit 지원에 의존하지 않는다.
        return await image.rotate()
          .resize(510, 258, { fit: "cover", position: "centre" })
          .flatten({ background: "#EEEBE5" }).jpeg({ quality: 85 })
          .timeout({ seconds: 2 }).toBuffer();
      } catch (err) {
        console.warn("[newsletter-image] fetch/decode failed", new URL(candidate).hostname,
          err instanceof Error ? err.message : "unknown error");
      }
    }
  }
  return null;
}
