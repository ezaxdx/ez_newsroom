/**
 * 디스코드 웹훅으로 운영 알림 전송 — 침묵 실패(아무도 모르게 실패하는 것)를 잡기 위함.
 * 실패해도(웹훅 URL 미설정, 네트워크 오류 등) 절대 호출부의 흐름을 막지 않음 —
 * 알림 자체가 본 기능(발송 등)을 막으면 안 되므로 항상 best-effort.
 */
type AlertLevel = "error" | "warning" | "info";

const LEVEL_COLOR: Record<AlertLevel, number> = {
  error: 0xdc2626,
  warning: 0xf59e0b,
  info: 0x2563eb,
};
const LEVEL_LABEL: Record<AlertLevel, string> = {
  error: "🔴 오류",
  warning: "🟡 경고",
  info: "🔵 안내",
};

export async function sendDiscordAlert(params: {
  title: string;
  description: string;
  level?: AlertLevel;
  fields?: { name: string; value: string }[];
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // 미설정 시 조용히 무시 — 알림 실패가 본 기능을 막으면 안 됨

  const level = params.level ?? "error";
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${LEVEL_LABEL[level]} · ${params.title}`,
          description: params.description,
          color: LEVEL_COLOR[level],
          fields: params.fields,
          timestamp: new Date().toISOString(),
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("[discord-alert] 전송 실패:", err);
  }
}
