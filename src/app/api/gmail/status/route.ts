import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("gmail_tokens")
    .select("refresh_token, updated_at")
    .eq("id", "singleton")
    .single();

  return NextResponse.json({
    connected: !!data?.refresh_token,
    updated_at: data?.updated_at ?? null,
  });
}
