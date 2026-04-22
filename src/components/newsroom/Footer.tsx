import { Rss, Mail } from "lucide-react";

const NAV_LINKS = ["Daily Digest", "Engineering Logs", "Strategy Board", "Product Roadmap"];
const SUPPORT_LINKS = ["Editorial Policy", "Source Submission", "Feedback Loop", "Internal Slack"];

export default function Footer() {
  return (
    <footer style={{ background: "var(--surface-container-low)" }}>
      {/* ── Top section ── */}
      <div
        className="max-w-[1280px] mx-auto px-8 py-12 grid gap-12"
        style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
      >
        {/* Brand */}
        <div className="flex flex-col gap-4">
          <p
            className="m-0 text-base font-bold tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            THE MONOLITH.
          </p>
          <p
            className="m-0 text-sm leading-relaxed max-w-[28ch]"
            style={{ color: "var(--on-surface-variant)" }}
          >
            The definitive source of news for the internal engineering
            and product leadership within the ecosystem. Curated by
            humans, powered by authority.
          </p>
        </div>

        {/* Navigation */}
        <div className="flex flex-col gap-4">
          <p
            className="m-0 text-[0.72rem] font-semibold tracking-[0.08em] uppercase"
            style={{ color: "var(--on-surface-variant)" }}
          >
            Navigation
          </p>
          <nav className="flex flex-col gap-2.5">
            {NAV_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="text-sm transition-colors hover:text-black"
                style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        {/* Support */}
        <div className="flex flex-col gap-4">
          <p
            className="m-0 text-[0.72rem] font-semibold tracking-[0.08em] uppercase"
            style={{ color: "var(--on-surface-variant)" }}
          >
            Support
          </p>
          <nav className="flex flex-col gap-2.5">
            {SUPPORT_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="text-sm transition-colors hover:text-black"
                style={{ color: "var(--on-surface-variant)", textDecoration: "none" }}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div
        className="max-w-[1280px] mx-auto px-8 py-4 flex items-center justify-between"
        style={{ borderTop: "1px solid var(--surface-container-highest)" }}
      >
        <p
          className="m-0 text-[0.68rem] font-medium tracking-[0.06em] uppercase"
          style={{ color: "var(--on-surface-variant)" }}
        >
          © 2024 The Monolith Newsroom. Internal Access Only.
        </p>
        <div className="flex items-center gap-3">
          <a
            href="#"
            aria-label="RSS"
            className="transition-opacity hover:opacity-60"
            style={{ color: "var(--on-surface-variant)", display: "flex" }}
          >
            <Rss size={15} />
          </a>
          <a
            href="#"
            aria-label="뉴스레터 구독"
            className="transition-opacity hover:opacity-60"
            style={{ color: "var(--on-surface-variant)", display: "flex" }}
          >
            <Mail size={15} />
          </a>
        </div>
      </div>
    </footer>
  );
}
