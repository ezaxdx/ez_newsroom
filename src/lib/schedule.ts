/**
 * 큐레이션 스케줄 유틸리티
 * 서버(Server Component)와 클라이언트(Client Component) 양쪽에서 사용 가능
 */

/**
 * 마지막 예약 큐레이션 실행 시각(UTC Date) 반환
 *
 * @param days   JS Date.getDay() 기준 한국시간(KST) 요일 배열
 *               [0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토]
 * @param hourKST 실행 시각 (KST 기준, 예: 9 → 오전 9시 KST = 00:00 UTC)
 *               hourKST >= 9 이어야 UTC 날짜가 같은 날로 유지됨
 *
 * 동작: 오늘부터 최대 7일 전까지 역순으로 탐색,
 *       스케줄 요일이면서 해당 시각이 이미 지난 가장 최근 날짜를 반환.
 *       스케줄이 없거나 찾지 못하면 7일 전을 반환(폴백).
 */
export function calcLastScheduledRun(days: number[], hourKST: number): Date {
  if (!days || days.length === 0) {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9
  const now = Date.now();

  for (let i = 0; i <= 7; i++) {
    const check = new Date(now - i * 24 * 60 * 60 * 1000);
    // 해당 날짜의 hourKST:00 KST = (hourKST-9):00 UTC
    check.setUTCHours(hourKST - 9, 0, 0, 0);
    const kstDay = new Date(check.getTime() + KST_OFFSET_MS).getUTCDay();
    if (days.includes(kstDay) && check.getTime() <= now) return check;
  }

  return new Date(now - 7 * 24 * 60 * 60 * 1000);
}
