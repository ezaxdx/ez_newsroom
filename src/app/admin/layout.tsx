import Link from "next/link";
import { LayoutDashboard, Rss, Settings, BarChart2, ArrowLeft, PenLine } from "lucide-react";

const NAV = [
  { href: "/admin", label: "큐레이션 보드", icon: LayoutDashboard },
  { href: "/admin/articles/new", label: "기사 작성", icon: PenLine },
  { href: "/admin/analytics", label: "애널리틱스", icon: BarChart2 },
  { href: "/admin/rss", label: "RSS 소스", icon: Rss },
  { href: "/admin/settings", label: "큐레이션 설정", icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex"
      style={{ background: "var(--surface-container-low)" }}
    >
      {/* ── Sidebar ── */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col gap-1 px-3 py-5"
        style={{ background: "var(--surface-container-lowest)" }}
      >
        {/* Logo */}
        <div className="px-3 mb-5">
          <p
            className="text-[0.65rem] font-semibold tracking-[0.08em] uppercase mb-0.5"
            style={{ color: "var(--on-surface-variant)" }}
          >
            Editorial Control
          </p>
          <p className="text-base font-bold tracking-tight m-0">The Monolith</p>
        </div>

        {/* Nav */}
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-[--surface-container-high]"
            style={{ color: "var(--on-surface)", textDecoration: "none" }}
          >
            <Icon size={15} style={{ color: "var(--on-surface-variant)" }} />
            {label}
          </Link>
        ))}

        {/* Back to newsroom */}
        <div className="mt-auto pt-4" style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-[--surface-container-high] rounded-md"
            style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
          >
            <ArrowLeft size={13} />
            뉴스룸으로 돌아가기
          </Link>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
