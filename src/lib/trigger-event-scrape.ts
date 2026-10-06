// 행사 수집 트리거 — 소스(akei/keoa/showala)별로 Edge Function 을 따로 호출
// 소스마다 실행 시간 한도(150초)를 따로 받아 KEOA 가 오래 걸려도 다른 소스가 막히지 않고, 실패도 소스별로 기록·알림됨.

const SOURCES = ["akei", "keoa", "showala"] as const;

export async function triggerEventScrape(): Promise<void> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-events`;
  // 게이트웨이(verify_jwt)는 유효한 JWT 를 요구하므로 service role key 로 호출 — CRON_SECRET 은 JWT 가 아니라 게이트웨이에서 401
  // (이전 cron 라우트가 Bearer CRON_SECRET 으로 호출해 항상 401 이었음)
  const authKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  await Promise.all(SOURCES.map(async (source) => {
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authKey}`,
          "X-Cron-Secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({ source }),
        // 응답을 기다리지 않아도 Edge Function 은 끝까지 실행됨 — 호출이 도달할 시간만 확보
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // 타임아웃이어도 Edge Function 은 계속 실행 중
    }
  }));
}
