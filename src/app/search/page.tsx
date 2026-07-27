import { NewsItem } from "@/lib/types";
import { DEFAULT_NAV_CATEGORIES } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import TopBar from "@/components/newsroom/TopBar";
import Footer from "@/components/newsroom/Footer";
import SearchResults from "@/components/newsroom/SearchResults";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

async function searchNews(query: string): Promise<NewsItem[]> {
  if (!query.trim() || !process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("news")
      .select("*")
      .eq("is_published", true)
      .or(`title.ilike.%${query}%,summary_short.ilike.%${query}%,content_long.ilike.%${query}%,implications.ilike.%${query}%`)
      .order("published_at", { ascending: false })
      .limit(50);
    return (data as NewsItem[]) ?? [];
  } catch {
    return [];
  }
}

async function fetchNavCategories(): Promise<string[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return DEFAULT_NAV_CATEGORIES;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("curation_settings")
      .select("nav_categories")
      .limit(1)
      .single();
    if (data?.nav_categories?.length) return data.nav_categories;
  } catch { /* fallback */ }
  return DEFAULT_NAV_CATEGORIES;
}

type Props = { searchParams: Promise<{ q?: string }> };

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const [navCategories, results] = await Promise.all([
    fetchNavCategories(),
    searchNews(query),
  ]);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--surface)" }}>
      <TopBar navCategories={navCategories} initialQuery={query} />

      <main className="flex-1 max-w-[1280px] mx-auto w-full px-8 py-8 pb-16">
        {/* Page header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-opacity hover:opacity-60"
            style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
          >
            <ArrowLeft size={12} /> 뉴스룸으로
          </Link>

          <div className="flex items-end gap-4">
            <div>
              <p
                className="text-[0.72rem] font-semibold tracking-[0.05em] uppercase m-0 mb-1"
                style={{ color: "var(--on-surface-variant)" }}
              >
                Search
              </p>
              <h1
                className="font-bold tracking-[-0.02em] m-0"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
              >
                {query ? `"${query}"` : "검색"}
              </h1>
            </div>
            {query && (
              <span className="mb-2 text-sm" style={{ color: "var(--on-surface-variant)" }}>
                총 {results.length}건
              </span>
            )}
          </div>
        </div>

        <SearchResults items={results} query={query} />
      </main>

      <Footer />
    </div>
  );
}
