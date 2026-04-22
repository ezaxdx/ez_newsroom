"use client";

import { Search } from "lucide-react";
import Link from "next/link";

type Props = {
  navCategories: string[];
};

export default function TopBar({ navCategories }: Props) {
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: "rgba(249,249,250,0.80)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      {/* ── Row 1: branding + actions ── */}
      <div className="max-w-[1280px] mx-auto px-8 pt-3 pb-2 flex items-center justify-between gap-4">
        <div>
          <p
            className="m-0 text-[0.75rem] font-semibold tracking-[0.05em] uppercase"
            style={{ color: "var(--on-surface-variant)" }}
          >
            Daily Briefing
          </p>
          <h1
            className="m-0 leading-[1.1] tracking-[-0.02em]"
            style={{ fontSize: "clamp(1.4rem, 2.5vw, 1.9rem)" }}
          >
            The Daily Monolith
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <label className="relative flex items-center">
            <Search
              size={14}
              className="absolute left-2.5 pointer-events-none"
              style={{ color: "var(--on-surface-variant)" }}
            />
            <input
              type="search"
              placeholder="이슈, 키워드 검색"
              aria-label="검색"
              className="h-8 w-56 rounded-md pl-8 pr-3 text-sm outline-none"
              style={{
                background: "var(--surface-container-low)",
                color: "var(--on-surface)",
                border: "1px solid transparent",
              }}
              onFocus={(e) => (e.currentTarget.style.border = "1px solid var(--primary)")}
              onBlur={(e) => (e.currentTarget.style.border = "1px solid transparent")}
            />
          </label>

          <Link
            href="/admin"
            className="inline-flex items-center h-9 px-4 rounded-md text-sm font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "linear-gradient(135deg, #000000, #1c1b1d)",
              color: "#ffffff",
            }}
          >
            큐레이션 관리
          </Link>
        </div>
      </div>

      {/* ── Row 2: category nav ── */}
      {navCategories.length > 0 && (
        <div
          className="max-w-[1280px] mx-auto px-8 pb-2 flex items-center gap-6"
          style={{ borderTop: "1px solid var(--surface-container-highest)" }}
        >
          {navCategories.map((cat) => (
            <Link
              key={cat}
              href={`/category/${cat.toLowerCase()}`}
              className="py-2 text-[0.72rem] font-semibold tracking-[0.05em] uppercase transition-colors hover:text-black"
              style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
            >
              {cat}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
