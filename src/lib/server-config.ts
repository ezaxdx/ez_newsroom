// 서버 전용 설정 — 브라우저 코드(use client)에서는 import하지 말 것.

const DEFAULT_SENDER_EMAIL = "ez.micedx1@gmail.com";

/**
 * 뉴스레터 발신 Gmail 계정.
 * 우선순위: GMAIL_USER → GMAIL_FROM_EMAIL(예전 변수명, 호환용) → 기본값
 * 발신 계정을 바꿀 때는 Vercel 환경변수 GMAIL_USER만 수정하면 된다.
 */
export function getSenderEmail(): string {
  return process.env.GMAIL_USER || process.env.GMAIL_FROM_EMAIL || DEFAULT_SENDER_EMAIL;
}
