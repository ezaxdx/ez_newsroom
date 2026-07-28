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
        } catch {
          // 접근 실패 시 기본 높이 유지
        }
      }}
      style={{ width: "100%", height, border: "none", display: "block" }}
      title="뉴스레터 지난호"
    />
  );
}
