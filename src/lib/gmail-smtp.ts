import nodemailer from "nodemailer";

let _transporter: nodemailer.Transporter | null = null;

export function getSmtpTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) throw new Error("GMAIL_USER 또는 GMAIL_APP_PASSWORD가 설정되지 않았습니다.");
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return _transporter;
}

export function getFromAddress(): string {
  const user = process.env.GMAIL_USER ?? "ez.micedx1@gmail.com";
  return `"EZ Letter" <${user}>`;
}
