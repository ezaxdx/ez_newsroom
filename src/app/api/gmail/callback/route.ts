import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/token-crypto";

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

    // 토큰 암호화 후 저장
    const [encAccessToken, encRefreshToken] = await Promise.all([
      tokens.access_token ? encryptToken(tokens.access_token) : Promise.resolve(null),
      tokens.refresh_token ? encryptToken(tokens.refresh_token) : Promise.resolve(null),
    ]);

    const supabase = createAdminClient();
    // refresh_token은 최초 인증 시에만 발급됨. null이면 기존 DB 값 유지 (덮어쓰지 않음)
    const upsertData: Record<string, unknown> = {
      id: "singleton",
      access_token: encAccessToken,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    };
    if (encRefreshToken) upsertData.refresh_token = encRefreshToken;
    const { error: dbError } = await supabase.from("gmail_tokens").upsert(upsertData);

    if (dbError) throw new Error(dbError.message);

    return NextResponse.redirect(new URL("/admin/gmail?success=true", req.url));
  } catch (e) {
    console.error("[Gmail callback 오류]", e);
    return NextResponse.redirect(new URL("/admin/gmail?error=token_failed", req.url));
  }
}
