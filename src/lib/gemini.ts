// Gemini REST 호출 주소를 한곳에서 관리한다. (서버 전용)
// 모델이 단종·교체될 때는 코드 수정 없이 Vercel 환경변수 GEMINI_MODEL만 바꾸면 된다.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/** generateContent 호출 주소 */
export function geminiGenerateUrl(apiKey: string): string {
  return `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

/** 사용 가능한 모델 목록 조회 주소 */
export function geminiListModelsUrl(apiKey: string): string {
  return `${GEMINI_BASE}/models?key=${apiKey}`;
}
