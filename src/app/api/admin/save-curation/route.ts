import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { NewsItem } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { items }: { items: NewsItem[] } = await req.json();

  const supabase = createAdminClient();
  for (const item of items) {
    await supabase
      .from("news")
      .update({ is_published: item.is_published, display_order: item.display_order })
      .eq("id", item.id);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true });
}
