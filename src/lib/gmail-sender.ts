/**
 * Gmail OAuth2를 사용한 이메일 발송 헬퍼
 * gmail_tokens 테이블에 저장된 OAuth 토큰을 사용
 */
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/token-crypto";

export async function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Gmail OAuth 환경변수가 설정되지 않았습니다.");
  }

  const supabase = createAdminClient();
  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expiry_date")
    .eq("id", "singleton")
    .single();

  if (!tokenRow?.refresh_token) {
    throw new Error("Gmail OAuth 토큰이 없습니다. 어드민에서 Gmail 연결을 먼저 해주세요.");
  }

  const accessToken  = tokenRow.access_token  ? await decryptToken(tokenRow.access_token)  : null;
  const refreshToken = await decryptToken(tokenRow.refresh_token);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token:  accessToken,
    refresh_token: refreshToken,
    expiry_date:   tokenRow.expiry_date,
  });

  // 토큰 갱신 시 DB 업데이트
  oauth2Client.on("tokens", async (tokens) => {
    const { encryptToken } = await import("@/lib/token-crypto");
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (tokens.access_token) updates.access_token = await encryptToken(tokens.access_token);
    if (tokens.refresh_token) updates.refresh_token = await encryptToken(tokens.refresh_token);
    if (tokens.expiry_date)   updates.expiry_date = tokens.expiry_date;
    await supabase.from("gmail_tokens").update(updates).eq("id", "singleton");
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

/** RFC2822 형식 이메일 메시지 생성 */
export function makeRawMessage(params: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const message = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(params.html).toString("base64"),
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(message).toString("base64url");
}

export type SendResult = { email: string; status: "success" | "failed"; error_message: string | null };

export async function sendNewsletterViaGmail(params: {
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  recipients: string[];
  onBatchComplete?: (results: SendResult[]) => Promise<void>;
}): Promise<{ results: SendResult[]; total_sent: number; total_failed: number }> {
  const gmail = await getGmailClient();

  const results: SendResult[] = [];
  let total_sent = 0;
  let total_failed = 0;

  // 5명씩 병렬 발송 + 배치 간 200ms 대기 (Gmail API 레이트 리밋 대응)
  const BATCH_SIZE = 5;
  for (let i = 0; i < params.recipients.length; i += BATCH_SIZE) {
    const batch = params.recipients.slice(i, i + BATCH_SIZE);
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const batchResults = await Promise.all(
      batch.map(async (to) => {
        try {
          const raw = makeRawMessage({
            from: `"${params.fromName}" <${params.fromEmail}>`,
            to,
            subject: params.subject,
            html: params.html,
          });
          await gmail.users.messages.send({
            userId: "me",
            requestBody: { raw },
          });
          total_sent++;
          return { email: to, status: "success" as const, error_message: null };
        } catch (err) {
          total_failed++;
          return {
            email: to,
            status: "failed" as const,
            error_message: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    results.push(...batchResults);
    if (params.onBatchComplete) await params.onBatchComplete(batchResults);
  }

  return { results, total_sent, total_failed };
}
