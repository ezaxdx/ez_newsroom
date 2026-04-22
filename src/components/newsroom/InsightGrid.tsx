"use client";

import { NewsItem } from "@/lib/types";

type Props = {
  items: NewsItem[];
  onOpen: (item: NewsItem) => void;
};

export default function InsightGrid({ items, onOpen }: Props) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <span className="block w-12 h-1" style={{ background: "var(--primary)" }} />
        <p
          className="m-0 text-[0.75rem] font-semibold tracking-[0.05em] uppercase"
          style={{ color: "var(--on-surface-variant)" }}
        >
          Insight
        </p>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {items.map((item) => (
          <article
            key={item.id}
            className="relative min-h-[360px] flex flex-col justify-end p-6 rounded overflow-hidden cursor-pointer group"
            style={{
              background: `
                linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.28) 48%, rgba(0,0,0,0)),
                radial-gradient(circle at 52% 38%, rgba(107,107,107,0.54), #1c1b1d 74%)
              `,
              color: "#ffffff",
            }}
            onClick={() => onOpen(item)}
          >
            {item.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image_url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-20"
              />
            )}

            <p
              className="m-0 text-[0.72rem] font-semibold tracking-[0.05em] uppercase mb-2"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              {item.category}
            </p>

            <h4
              className="m-0 font-bold leading-[1.35] mb-4 group-hover:underline underline-offset-4"
              style={{ fontSize: "1.25rem" }}
            >
              {item.title}
            </h4>

            <button
              className="self-start h-8 px-4 rounded-md text-xs font-bold tracking-[0.04em] uppercase transition-opacity hover:opacity-80"
              style={{ background: "#fff", color: "#000", border: "none", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            >
              VIEW INSIGHT
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
