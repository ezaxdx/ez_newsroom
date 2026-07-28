import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import TopBar from "@/components/newsroom/TopBar";
import Footer from "@/components/newsroom/Footer";
import NewsletterArchiveList, { ArchiveIssue } from "@/components/newsroom/NewsletterArchiveList";

export const dynamic = "force-dynamic";

async function fetchIssues(): Promise<ArchiveIssue[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("newsletter_issues")
      .select("vol_number, editorial_text, sent_at")
      .eq("status", "sent")
      .order("vol_number", { ascending: false })
      .order("sent_at", { ascending: false })
      .limit(300);
    // 재발송 등으로 같은 vol_number가 여러 행일 수 있어 — 가장 최근 발송분만 남김
    const seen = new Set<number>();
    const deduped: ArchiveIssue[] = [];
    for (const row of (data ?? []) as ArchiveIssue[]) {
      if (seen.has(row.vol_number)) continue;
      seen.add(row.vol_number);
      deduped.push(row);
    }
    return deduped;
  } catch {
    return [];
  }
}

async function fetchNavCategories(): Promise<string[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return DEFAULT_NAV_CATEGORIES;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from("curation_settings").select("nav_categories").limit(1).single();
    return data?.nav_categories?.length ? data.nav_categories : DEFAULT_NAV_CATEGORIES;
  } catch {
    return DEFAULT_NAV_CATEGORIES;
  }
}

export default async function NewsletterArchivePage() {
  const [issues, navCategories] = await Promise.all([fetchIssues(), fetchNavCategories()]);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
      <TopBar navCategories={navCategories} />

      <main className="flex-1 max-w-[1280px] mx-auto w-full px-8 py-8 pb-16">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-opacity hover:opacity-60"
            style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
          >
            <ArrowLeft size={12} /> 뉴스룸으로
          </Link>
          <p className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-1"
            style={{ color: "var(--on-surface-variant)" }}>
            Newsletter Archive
          </p>
          <h1 className="font-bold tracking-[-0.02em] m-0" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            지난호 보기
          </h1>
        </div>

        <NewsletterArchiveList issues={issues} />
      </main>

      <Footer />
    </div>
  );
}
