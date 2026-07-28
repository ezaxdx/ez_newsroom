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
  unsubscribeUrl?: string;
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminEmail = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  const unsubMailto = `mailto:${adminEmail}?subject=%EB%AC%B8%EC%9D%98%ED%95%98%EA%B8%B0`;
  // 메일 클라이언트가 헤더에 있는 링크를 스캔 단계에서 미리 열어보는 경우가 있어(보안 스캐너 프리페치),
  // GET만으로 즉시 수신거부되지 않고 확인 페이지를 거치도록 설계함 — 그래서 List-Unsubscribe-Post(원클릭)는 넣지 않음
  const unsubHeaderParts = [`<${unsubMailto}>`, ...(params.unsubscribeUrl ? [`<${params.unsubscribeUrl}>`] : [])];
  const domain = adminEmail.split("@")[1] ?? "gmail.com";

  // plain text: HTML 태그 제거 후 간단한 fallback
  const plainText = params.html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 500);

  // Date/Message-ID 누락, 전형적 1:1 개인메일 헤더 형태는 대량발송 스팸필터에 취약함.
  // 정상적인 뉴스레터/사내공지 메일임을 밝히는 표준 헤더를 명시적으로 채움
  // (수신거부 자동화 기능과는 무관 — mailto는 기존 그대로 유지)
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;
  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `List-Unsubscribe: ${unsubHeaderParts.join(", ")}`,
    `List-ID: EZ Letter <ez-letter.${domain}>`,
    "Precedence: bulk",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const message = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(plainText).toString("base64"),
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

/** 개별 발송 타임아웃 — 한 건이 멈춰도 전체가 안 끌려가게 */
const PER_SEND_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`발송 타임아웃 (${ms / 1000}초)`)), ms)
    ),
  ]);
}

export async function sendNewsletterViaGmail(params: {
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  /** 문자열(이메일만)도 허용 — id가 없으면 개인화 수신거부 링크는 생성되지 않음(기존 재발송 경로 호환용) */
  recipients: (string | { email: string; id: string })[];
  /** 수신거부 확인 페이지의 기준 URL (예: https://뉴스룸.com) — 없으면 개인화 링크 미삽입 */
  siteUrl?: string;
  /** 오픈 트래킹 픽셀에 심을 이 호(issue)의 id — 없으면 오픈 트래킹 미삽입 */
  issueId?: string;
  /** 전체 시간 예산(ms) — 초과 시 남은 수신자는 처리하지 않고 반환 (Vercel 강제종료 방지) */
  timeBudgetMs?: number;
  onBatchComplete?: (results: SendResult[]) => Promise<void>;
}): Promise<{ results: SendResult[]; total_sent: number; total_failed: number; processed: number }> {
  const gmail = await getGmailClient();
  const started = Date.now();
  const recipients = params.recipients.map(r => typeof r === "string" ? { email: r, id: null as string | null } : r);

  const results: SendResult[] = [];
  let total_sent = 0;
  let total_failed = 0;

  // 5명씩 병렬 발송 + 배치 간 200ms 대기 (Gmail API 레이트 리밋 대응)
  const BATCH_SIZE = 5;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    // 시간 예산 초과 → 즉시 중단, 미처리분은 다음 회차에서 발송 (로그 기반 중복 방지)
    if (params.timeBudgetMs && Date.now() - started > params.timeBudgetMs) break;

    const batch = recipients.slice(i, i + BATCH_SIZE);
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const batchResults = await Promise.all(
      batch.map(async ({ email: to, id }) => {
        try {
          // 수신거부 링크에 수신자별 id를 심어서 "누가 눌렀는지" 식별 가능하게 함
          const unsubscribeUrl = id && params.siteUrl ? `${params.siteUrl}/api/newsletter/unsubscribe?id=${id}` : undefined;
          let personalizedHtml = id ? params.html.replaceAll("__EZ_UNSUB_ID__", id) : params.html;
          if (params.issueId) personalizedHtml = personalizedHtml.replaceAll("__EZ_ISSUE_ID__", params.issueId);
          const raw = makeRawMessage({
            from: `"${params.fromName}" <${params.fromEmail}>`,
            to,
            subject: params.subject,
            html: personalizedHtml,
            unsubscribeUrl,
          });
          await withTimeout(
            gmail.users.messages.send({ userId: "me", requestBody: { raw } }),
            PER_SEND_TIMEOUT_MS
          );
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

  return { results, total_sent, total_failed, processed: results.length };
}
