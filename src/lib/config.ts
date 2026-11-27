// 기본 카테고리 (DB에 데이터 없을 때 폴백)
export const DEFAULT_CATEGORIES = ["MICE", "TOURISM", "AI"];
export const DEFAULT_NAV_CATEGORIES = DEFAULT_CATEGORIES;

// 하위 호환성 (기존 코드에서 참조 중인 경우)
export const ALL_CATEGORIES = DEFAULT_CATEGORIES;

// ─────────────────────────────────────────────────────────────
// 서비스 공통 설정 — 주소·이름·제목 형식은 여기만 고치면 전체에 반영된다.
// (서버·브라우저 양쪽에서 import 가능. 비밀값은 넣지 말 것 → 서버 전용은 server-config.ts)
// ─────────────────────────────────────────────────────────────

const DEFAULT_SITE_URL = "https://ez-newsroom.vercel.app";

/** 운영 사이트 주소(끝 슬래시 없음). Vercel 환경변수 NEXT_PUBLIC_SITE_URL로 덮어쓸 수 있다. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");

/** 뉴스레터 이름 — 발신자명·제목에 공통으로 쓴다. */
export const NEWSLETTER_NAME = "EZ Letter";

/** 발송 메일 기본 제목. 예) [EZ Letter] Vol.7 · 2026.11.27 */
export function newsletterSubject(vol: number | string, sendDate: string): string {
  return `[${NEWSLETTER_NAME}] Vol.${vol} · ${sendDate}`;
}
