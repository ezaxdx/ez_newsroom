"use client";

import { useRef, useState } from "react";

export default function NewsletterIssueFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1200);

  return (
    <iframe
      ref={ref}
      srcDoc={html}
      onLoad={() => {
        try {
          const doc = ref.current?.contentWindow?.document;
          if (doc?.body) setHeight(doc.body.scrollHeight + 20);
          // 지난호는 그냥 보기용 — 뉴스 카드·버튼 등 어떤 링크도 클릭되지 않게 막음
          const style = doc?.createElement("style");
          if (style && doc) {
            style.textContent = "a, a * { pointer-events: none !important; cursor: default !important; }";
            doc.head.appendChild(style);
          }
        } catch {
          // 접근 실패 시 기본 높이 유지
        }
      }}
      style={{ width: "100%", height, border: "none", display: "block" }}
      title="뉴스레터 지난호"
    />
  );
}
