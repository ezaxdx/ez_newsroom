"use client";

import { NewsItem } from "@/lib/types";

type Props = {
  label: string;
  items: NewsItem[];
  onOpen: (item: NewsItem) => void;
};

export default function FeedBlock({ label, items, onOpen }: Props) {
  return (
    <section id={label.toLowerCase()}>
      {/* Accent bar + label */}
      <div className="flex items-center gap-3 mb-5">
        <span className="block w-12 h-1" style={{ background: "var(--primary)" }} />
        <p
          className="m-0 text-[0.75rem] font-semibold tracking-[0.05em] uppercase"
          style={{ color: "var(--on-surface-variant)" }}
        >
          {label}
        </p>
      </div>

      {/* Horizontal article grid */}
      <div
        className="grid gap-6"
        style={{
          gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)`,
        }}
      >
        {items.map((item) => (
          <article
            key={item.id}
            className="flex flex-col cursor-pointer group"
            onClick={() => onOpen(item)}
          >
            {/* image placeholder or actual image */}
            <div
              className="w-full mb-3 rounded overflow-hidden"
              style={{
                aspectRatio: "16/9",
                background: item.image_url
                  ? undefined
                  : "var(--surface-container-highest)",
              }}
            >
              {item.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.image_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            {/* title */}
            <h3
              className="font-bold leading-[1.3] tracking-[-0.01em] mb-2 group-hover:underline underline-offset-4"
              style={{
                fontSize: "1.05rem",
                color: "var(--on-surface)",
              }}
            >
              {item.title}
            </h3>

            {/* summary */}
            <p
              className="m-0 text-[0.83rem] leading-relaxed line-clamp-3"
              style={{ color: "var(--on-surface-variant)" }}
            >
              {item.summary_short}
            </p>

            {/* read more */}
            <button
              className="self-start mt-3 text-[0.7rem] font-semibold tracking-[0.04em] uppercase hover:underline"
              style={{
                color: "var(--on-surface-variant)",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            >
              READ MORE →
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
