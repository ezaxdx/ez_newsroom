import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const SELECT = "id, title, start_date, end_date, image_url, link_url, content, is_active, display_type, position, pages, random_page, hunt_code, size_px, created_at";

const VALID_PAGES = new Set(["home", "category", "events", "archive"]);
function normalizePages(pages: unknown): string[] {
  const list = Array.isArray(pages) ? pages.filter((p) => VALID_PAGES.has(p)) : [];
  return list.length ? list : ["home"];
}

// 3×3 위치 + 랜덤 — 그 외 값이 들어오면 기본값으로 떨어뜨림
const VALID_POSITIONS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
  "random",
]);

// 표시 방식별 사이즈(px) 허용 범위 — 이 범위 밖 값은 무시하고 null(=기본값) 처리
const SIZE_RANGE: Record<string, { min: number; max: number }> = {
  floating: { min: 60, max: 400 },
  modal: { min: 240, max: 640 },
};
function normalizeSize(displayType: string, size: unknown): number | null {
  const n = Number(size);
  const range = SIZE_RANGE[displayType] ?? SIZE_RANGE.modal;
  if (!Number.isFinite(n) || n < range.min || n > range.max) return null;
  return Math.round(n);
}

export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsroom_popups")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const { title, start_date, end_date, image_url, link_url, content, is_active, display_type, position, pages, random_page, hunt_code, size_px } = body;
  if (!title?.trim() || !start_date || !end_date) {
    return NextResponse.json({ error: "제목, 게시기간은 필수입니다." }, { status: 400 });
  }
  if (!image_url && !content?.trim()) {
    return NextResponse.json({ error: "이미지 또는 내용 중 하나는 있어야 합니다." }, { status: 400 });
  }

  const resolvedType = display_type === "floating" ? "floating" : "modal";
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsroom_popups")
    .insert({
      title: title.trim(),
      start_date,
      end_date,
      image_url: image_url || null,
      link_url: link_url?.trim() || null,
      content: content?.trim() || null,
      is_active: is_active ?? true,
      display_type: resolvedType,
      position: VALID_POSITIONS.has(position) ? position : "bottom-right",
      pages: normalizePages(pages),
      random_page: !!random_page,
      hunt_code: hunt_code?.trim() || null,
      size_px: normalizeSize(resolvedType, size_px),
    })
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ALLOWED = ["title", "start_date", "end_date", "image_url", "link_url", "content", "is_active", "display_type", "position", "pages", "random_page", "hunt_code", "size_px"];
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in fields) updates[key] = fields[key];
  }
  if ("pages" in updates) updates.pages = normalizePages(updates.pages);
  if ("random_page" in updates) updates.random_page = !!updates.random_page;
  if ("size_px" in updates) {
    const type = typeof updates.display_type === "string" ? updates.display_type : (fields.display_type ?? "modal");
    updates.size_px = normalizeSize(type, updates.size_px);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsroom_popups")
    .update(updates)
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from("newsroom_popups").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
