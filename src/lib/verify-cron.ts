/**
 * Vercel Cron 요청 인증 검증
 * CRON_SECRET이 비어 있으면 "Bearer undefined"로 우회될 수 있어 명시적으로 거부함
 */
export function verifyCronAuth(req: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
