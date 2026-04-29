import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/admin/gmail?error=access_denied", req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/admin/gmail?error=no_code", req.url));
  }

  const clientId = process.env.GMAIL_CLIENT_ID!;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
  const redirectUri = process.env.GMAIL_REDIRECT_URI!;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  try {
    const { tokens } = await oauth2Client.getToken(code);

    const supabase = createAdminClient();
    const { error: dbError } = await supabase.from("gmail_tokens").upsert({
      id: "singleton", // 단일 레코드 유지
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    });

    if (dbError) throw new Error(dbError.message);

    return NextResponse.redirect(new URL("/admin/gmail?success=true", req.url));
  } catch (e) {
    console.error("[Gmail callback 오류]", e);
    return NextResponse.redirect(new URL("/admin/gmail?error=token_failed", req.url));
  }
}
