"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Rss, Settings, BarChart2, ArrowLeft, PenLine, LogOut, ShieldCheck, Mail, Megaphone, Menu, X } from "lucide-react";

const NAV = [
  { href: "/admin", label: "큐레이션 보드", icon: LayoutDashboard },
  { href: "/admin/articles/new", label: "기사 작성", icon: PenLine },
  { href: "/admin/analytics", label: "애널리틱스", icon: BarChart2 },
  { href: "/admin/rss", label: "RSS 소스 매니저", icon: Rss },
  { href: "/admin/settings", label: "큐레이션 설정", icon: Settings },
  { href: "/admin/quality", label: "정합성 관리", icon: ShieldCheck },
  { href: "/admin/newsletter", label: "뉴스레터 관리", icon: Mail },
  { href: "/admin/popups", label: "팝업 관리", icon: Megaphone },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/");
    router.refresh();
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-3 mb-5 flex items-center justify-between">
        <div>
          <p
            className="text-[0.65rem] font-semibold tracking-[0.08em] uppercase mb-0.5"
            style={{ color: "var(--on-surface-variant)" }}
          >
            Editorial Control
          </p>
          <p className="text-base font-bold tracking-tight m-0">The Monolith</p>
        </div>
        {/* 좁은 화면에서만 보이는 닫기 버튼(드로어) */}
        <button
          onClick={() => setMobileNavOpen(false)}
          className="md:hidden"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--on-surface-variant)" }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      {NAV.map(({ href, label, icon: Icon }) => {
        const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setMobileNavOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-[--surface-container-high]"
            style={{
              color: "var(--on-surface)",
              fontWeight: isActive ? 700 : 500,
              background: isActive ? "var(--surface-container-high)" : "transparent",
              textDecoration: "none",
            }}
          >
            <Icon size={15} style={{ color: isActive ? "var(--primary)" : "var(--on-surface-variant)" }} />
            {label}
          </Link>
        );
      })}

      {/* Back to newsroom + Logout */}
      <div className="mt-2 pt-2 flex flex-col gap-1" style={{ borderTop: "1px solid var(--surface-container-highest)" }}>
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-[--surface-container-high] rounded-md"
          style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
        >
          <ArrowLeft size={13} />
          뉴스룸으로 돌아가기
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-[--surface-container-high] rounded-md w-full"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", textAlign: "left" }}
        >
          <LogOut size={13} />
          로그아웃
        </button>
      </div>
    </>
  );

  return (
    <div
      className="min-h-screen flex flex-col md:flex-row"
      style={{ background: "var(--surface-container-low)" }}
    >
      {/* ── 좁은 화면 전용 상단바(햄버거) ── */}
      <div
        className="md:hidden flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: "var(--surface-container-lowest)", borderBottom: "1px solid var(--surface-container-highest)" }}
      >
        <p className="text-sm font-bold tracking-tight m-0">The Monolith</p>
        <button
          onClick={() => setMobileNavOpen(true)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--on-surface)" }}
        >
          <Menu size={20} />
        </button>
      </div>

      {/* ── 좁은 화면: 오버레이 드로어 ── */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setMobileNavOpen(false)}
          />
          <aside
            className="relative w-64 flex-shrink-0 flex flex-col gap-1 px-3 py-5 overflow-y-auto"
            style={{ background: "var(--surface-container-lowest)" }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* ── 넓은 화면: 고정 사이드바 ── */}
      <aside
        className="hidden md:flex w-56 flex-shrink-0 flex-col gap-1 px-3 py-5"
        style={{ background: "var(--surface-container-lowest)" }}
      >
        {sidebarContent}
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-auto min-w-0">{children}</main>
    </div>
  );
}
