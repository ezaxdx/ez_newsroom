"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { logEvent } from "@/lib/analytics";

export type ArchiveIssue = {
  vol_number: number;
  editorial_text: string | null;
  sent_at: string | null;
};

type Props = { issues: ArchiveIssue[] };

const PAGE_SIZE = 12;

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

export default function NewsletterArchiveList({ issues }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [monthFilter, setMonthFilter] = useState<string>("all");

  useEffect(() => {
    logEvent({ event_type: "newsletter_archive_view" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (issues.length === 0) {
    return (
      <p className="text-sm py-12 text-center" style={{ color: "var(--on-surface-variant)" }}>
        아직 발송된 뉴스레터가 없습니다.
      </p>
    );
  }

  const months = Array.from(new Set(
    issues.map((i) => (i.sent_at ?? "").slice(0, 7)).filter(Boolean)
  )).sort((a, b) => b.localeCompare(a));

  const filteredIssues = monthFilter === "all"
    ? issues
    : issues.filter((i) => (i.sent_at ?? "").slice(0, 7) === monthFilter);

  const visible = monthFilter === "all" ? filteredIssues.slice(0, visibleCount) : filteredIssues;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <select
          value={monthFilter}
          onChange={(e) => { setMonthFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
          className="text-sm rounded-lg px-3 py-2"
          style={{ border: "1px solid var(--surface-container-highest)", background: "var(--surface-container-lowest)", color: "var(--on-surface)" }}
        >
          <option value="all">전체 기간</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--on-surface-variant)" }}>
          {filteredIssues.length}건
        </span>
      </div>

      {filteredIssues.length === 0 ? (
        <p className="text-sm py-12 text-center" style={{ color: "var(--on-surface-variant)" }}>
          해당 기간에 발송된 뉴스레터가 없습니다.
        </p>
      ) : (
      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {visible.map((issue) => (
          <Link
            key={issue.vol_number}
            href={`/newsletter/archive/${issue.vol_number}`}
            className="block rounded-xl overflow-hidden transition-transform hover:-translate-y-0.5"
            style={{ background: "var(--surface-container-lowest)", border: "1px solid var(--surface-container-highest)", textDecoration: "none", color: "inherit" }}
          >
            <div
              className="flex flex-col justify-center px-6 py-8"
              style={{ background: "linear-gradient(135deg, var(--primary) 0%, #3c5a2e 100%)", color: "#fff", minHeight: 120 }}
            >
              <span className="text-xs font-semibold tracking-[0.1em] uppercase opacity-80">EZ Letter</span>
              <span className="text-2xl font-bold tracking-tight mt-1">Vol.{String(issue.vol_number).padStart(2, "0")}</span>
            </div>
            <div className="p-5">
              <p className="text-xs mb-2" style={{ color: "var(--on-surface-variant)" }}>
                {formatDate(issue.sent_at)}
              </p>
              <p className="text-sm line-clamp-3" style={{ color: "var(--on-surface)" }}>
                {issue.editorial_text?.trim() || "이번 호 EZ Letter를 확인해보세요."}
              </p>
            </div>
          </Link>
        ))}
      </div>
      )}

      {monthFilter === "all" && visibleCount < filteredIssues.length && (
        <div className="text-center mt-8">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="px-5 py-2 rounded-full text-sm font-medium"
            style={{ border: "1px solid var(--surface-container-highest)", background: "var(--surface-container-lowest)", color: "var(--on-surface)" }}
          >
            더보기 (전체 {filteredIssues.length}건)
          </button>
        </div>
      )}
    </div>
  );
}
