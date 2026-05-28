"use client";

/**
 * 기사 이미지 컴포넌트
 * - image_url 없거나 hasRealImage=false → 폴백 로고 표시
 * - HTTP 200이지만 빈/손상 이미지(naturalWidth<5) → 폴백 전환
 * - React hydration 전에 이미지가 로드돼도 useEffect로 사후 체크
 * - onError → 폴백 전환
 */

import { useEffect, useRef } from "react";
import type React from "react";
import { FALLBACK_IMAGE, hasRealImage } from "@/lib/news-ui";

type Props = {
  src: string | null | undefined;
  alt?: string;
  /** 실제 이미지에 붙는 className */
  className?: string;
  /** 실제 이미지 style */
  style?: React.CSSProperties;
  /** 폴백 로고 width (기본 "40%") */
  fallbackWidth?: string;
};

const fallbackBaseStyle = (width: string): React.CSSProperties => ({
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width,
  height: "auto",
  objectFit: "contain",
});

export default function ArticleImg({
  src,
  alt = "",
  className = "",
  style = {},
  fallbackWidth = "40%",
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const isReal = hasRealImage(src);

  const applyFallback = (img: HTMLImageElement) => {
    if (img.getAttribute("data-fb") === "1") return;
    img.setAttribute("data-fb", "1");
    img.src = FALLBACK_IMAGE;
    img.className = "";
    img.removeAttribute("style");
    const fb = fallbackBaseStyle(fallbackWidth);
    (Object.keys(fb) as (keyof React.CSSProperties)[]).forEach((k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (img.style as any)[k] = fb[k];
    });
  };

  // React hydration 전에 이미지가 이미 로드된 경우 사후 체크
  useEffect(() => {
    const img = imgRef.current;
    if (!img || img.getAttribute("data-fb") === "1") return;
    if (img.complete && (img.naturalWidth < 5 || img.naturalHeight < 5)) {
      applyFallback(img);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src || FALLBACK_IMAGE}
      alt={alt}
      className={isReal ? className : ""}
      style={isReal ? style : fallbackBaseStyle(fallbackWidth)}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.getAttribute("data-fb") === "1") return;
        if (img.naturalWidth < 5 || img.naturalHeight < 5) {
          applyFallback(img);
        }
      }}
      onError={(e) => applyFallback(e.currentTarget)}
    />
  );
}
