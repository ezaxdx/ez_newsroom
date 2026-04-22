import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await req.json();

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.from("news").insert({
    title: body.title,
    summary_short: body.summary_short,
    content_long: body.content_long,
    implications: body.implications,
    image_url: body.image_url || null,
    original_url: body.original_url || null,
    category: body.category,
    is_published: body.is_published ?? false,
    priority_score: 50,
    display_order: 999,
    published_at: new Date().toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
