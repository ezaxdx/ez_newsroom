// 뉴스레터 AI 인사말 프롬프트 — 기본값과 치환 규칙. 관리자 화면(AI로 작성 옆 "설정")에서 수정한 값은 newsletter_cron_settings.editorial_prompt 에 저장됨
export const DEFAULT_EDITORIAL_PROMPT = `MICE·관광 업계에서 일하는 실무자가 동료들에게 보내는 뉴스레터 인사말을 써줘.

오늘은 {{월}}월 {{일}}일이야.

이번 호 뉴스:
{{뉴스}}{{행사}}

조건:
- 3~4문장, 70~110자 내외
- 실무자가 직접 쓴 것처럼 자연스럽고 편안한 말투
- 계절·날씨·{{월}}월의 업계 분위기를 자연스럽게 녹여줘
- 위 뉴스나 행사 중 하나를 구체적으로 언급해서 "이번 호에 담겨 있다"는 느낌을 살짝 줘도 좋아 (단, 내용 요약은 금지)
- AI·데이터·기술 관점 언급 금지
- "안녕하세요" 없이 바로 시작
- 마지막은 "오늘도 EZ하게 시작해볼까요?" 또는 같은 뉘앙스로 마무리
- 본문만 출력, 서명 없음`;

export function fillEditorialPrompt(template: string, v: { month: number; day: number; weekday: string; news: string; events: string }): string {
  // 요일은 AI 가 추측하면 틀리므로 한국 시간 기준 값을 항상 덧붙임 ({{요일}} 을 직접 쓰면 그 자리에 들어감)
  const withRef = template.includes("{{요일}}") ? template : `${template}\n\n(참고: 한국 시간 기준 오늘은 ${v.month}월 ${v.day}일 ${v.weekday}요일. 요일·날짜를 임의로 추측하지 마.)`;
  return withRef.replaceAll("{{요일}}", v.weekday)
    .replaceAll("{{월}}", String(v.month)).replaceAll("{{일}}", String(v.day))
    .replaceAll("{{뉴스}}", v.news).replaceAll("{{행사}}", v.events ? `\n이번 주 주목할 행사: ${v.events}` : "");
}
