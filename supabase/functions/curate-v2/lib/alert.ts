// 디스코드 알림 — best-effort: 실패해도 큐레이션을 절대 막지 않음
export type AlertLevel = "error" | "warning" | "info";
const COLOR: Record<AlertLevel, number> = { error: 0xdc2626, warning: 0xf59e0b, info: 0x2563eb };
const LABEL: Record<AlertLevel, string> = { error: "🔴 오류", warning: "🟡 경고", info: "🔵 안내" };

export interface AlertMsg {
  title: string;
  description: string;
  level?: AlertLevel;
  fields?: { name: string; value: string }[];
}

export async function sendAlert(webhookUrl: string | undefined, msg: AlertMsg): Promise<boolean> {
  if (!webhookUrl) return false;
  const level = msg.level ?? "error";
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${LABEL[level]} · ${msg.title}`.slice(0, 250),
          description: msg.description.slice(0, 1800),
          color: COLOR[level],
          fields: (msg.fields ?? []).slice(0, 10).map((f) => ({ name: f.name.slice(0, 250), value: (f.value || "-").slice(0, 900) })),
          timestamp: new Date().toISOString(),
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (e) {
    console.error("[discord-alert] 전송 실패:", e);
    return false;
  }
}
