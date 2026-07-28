import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import TopBar from "@/components/newsroom/TopBar";
import Footer from "@/components/newsroom/Footer";
import NewsletterIssueFrame from "@/components/newsroom/NewsletterIssueFrame";
import LogNewsletterIssueView from "@/components/newsroom/LogNewsletterIssueView";

export const dynamic = "force-dynamic";

async function fetchIssue(vol: number): Promise<{ html_content: string; sent_at: string | null } | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const supabase = createAdminClient();
    // 목록 페이지와 동일한 기준(total_sent > 0) — "일부발송"이어도 실제 전달된 발행분은 그대로 노출
    const { data } = await supabase
      .from("newsletter_issues")
      .select("html_content, sent_at")
      .eq("vol_number", vol)
      .gt("total_sent", 0)
      .not("html_content", "is", null)
      .order("total_sent", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
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

type Props = { params: Promise<{ vol: string }> };

export default async function NewsletterIssuePage({ params }: Props) {
  const { vol: volStr } = await params;
  const vol = Number(volStr);
  if (!Number.isInteger(vol)) notFound();

  const [issue, navCategories] = await Promise.all([fetchIssue(vol), fetchNavCategories()]);
  if (!issue) notFound();

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
      <LogNewsletterIssueView vol={vol} />
      <TopBar navCategories={navCategories} />

      <main className="flex-1 max-w-[900px] mx-auto w-full px-4 py-8 pb-16">
        <Link
          href="/newsletter/archive"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-opacity hover:opacity-60"
          style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
        >
          <ArrowLeft size={12} /> 지난호 목록으로
        </Link>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--surface-container-highest)" }}>
          <NewsletterIssueFrame html={issue.html_content} />
        </div>
      </main>

      <Footer />
    </div>
  );
}
