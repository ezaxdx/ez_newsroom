import { Resend } from "resend";

let _resend: Resend | null = null;

export function getResendClient(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY가 설정되지 않았습니다.");
    _resend = new Resend(apiKey);
  }
  return _resend;
}

export function getFromAddress(): string {
  return process.env.RESEND_FROM ?? "EZ Letter <onboarding@resend.dev>";
}
