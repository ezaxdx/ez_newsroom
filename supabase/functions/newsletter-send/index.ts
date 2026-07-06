// Supabase Edge Function — newsletter-send
// Deno 런타임 (Node.js 아님)
// Gmail SMTP via npm:nodemailer
// EdgeRuntime.waitUntil() → 응답 반환 후에도 150초까지 백그라운드 발송 가능

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendPayload {
  issue_id: string;
  recipients: string[];
  subject: string;
  html: string;
}

async function sendEmails({
  supabase,
  issueId,
  recipients,
  subject,
  html,
  gmailUser,
  gmailPass,
}: {
  supabase: ReturnType<typeof createClient>;
  issueId: string;
  recipients: string[];
  subject: string;
  html: string;
  gmailUser: string;
  gmailPass: string;
}) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });
  const from = `"EZ Letter" <${gmailUser}>`;

  // 이미 성공한 수신자 로드 → 중복 발송 방지
  const { data: alreadySent } = await supabase
    .from("newsletter_send_logs")
    .select("email")
    .eq("issue_id", issueId)
    .eq("status", "success");
  const sentSet = new Set(
    (alreadySent ?? []).map((r: { email: string }) => r.email)
  );

  let total_sent = 0;
  let total_failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    if (sentSet.has(to)) continue;
    if (i > 0) await new Promise((r) => setTimeout(r, 200));

    try {
      await transporter.sendMail({ from, to, subject, html });
      await supabase.from("newsletter_send_logs").insert([{
        email: to,
        issue_id: issueId,
        status: "success",
        error_message: null,
      }]);
      sentSet.add(to);
      total_sent++;
    } catch (err) {
      await supabase.from("newsletter_send_logs").insert([{
        email: to,
        issue_id: issueId,
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
      }]);
      total_failed++;
    }
  }

  const target = recipients.length;
  const finalStatus =
    total_sent === 0
      ? "failed"
      : total_sent >= target && total_failed === 0
      ? "sent"
      : "partial";

  await supabase
    .from("newsletter_issues")
    .update({ status: finalStatus, total_sent, total_failed })
    .eq("id", issueId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 서비스 롤 키 인증
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: SendPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { issue_id, recipients, subject, html } = body;
  if (!issue_id || !Array.isArray(recipients) || recipients.length === 0 || !subject || !html) {
    return new Response(JSON.stringify({ error: "필수 파라미터 누락" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) {
    return new Response(JSON.stringify({ error: "Gmail 환경변수 미설정 (GMAIL_USER, GMAIL_APP_PASSWORD)" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 백그라운드에서 발송 시작 — 응답 반환 후에도 최대 150초까지 실행됨
  EdgeRuntime.waitUntil(
    sendEmails({ supabase, issueId: issue_id, recipients, subject, html, gmailUser, gmailPass })
  );

  // 즉시 응답 반환 (브라우저 네트워크 오류 없음)
  return new Response(
    JSON.stringify({ ok: true, queued: true, count: recipients.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
