/**
 * EZ Letter 로고 컴포넌트
 * 웹/어드민 페이지에서 사용하는 인라인 SVG 버전
 * 폰트: Pretendard (Bold / ExtraBold)
 */

type Props = {
  width?: number;
  /** "default" = 초록 blob / "light" = 크림 배경 흰 텍스트 */
  variant?: "default" | "light";
  className?: string;
};

export default function EzLetterLogo({ width = 240, variant = "default", className }: Props) {
  const blobColor  = variant === "light" ? "#F5F0E8" : "#50723C";
  const textColor  = variant === "light" ? "#3D5A2E" : "#F5F0E8";
  const strokeColor = variant === "light" ? "#3D5A2E" : "#F5F0E8";
  const height = Math.round(width * 0.72);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 173"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="EZ Letter"
    >
      <defs>
        <style>{`
          @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
        `}</style>
      </defs>

      {/* Organic blob */}
      <path
        d="
          M 30,90
          C 18,50 55,18 100,14
          C 145,10 195,8 218,40
          C 240,72 238,120 210,148
          C 182,176 130,168 85,160
          C 40,152 42,130 30,90
          Z
        "
        fill={blobColor}
      />

      {/* 외곽 stroke (optional depth) */}
      <path
        d="
          M 30,90
          C 18,50 55,18 100,14
          C 145,10 195,8 218,40
          C 240,72 238,120 210,148
          C 182,176 130,168 85,160
          C 40,152 42,130 30,90
          Z
        "
        fill="none"
        stroke={strokeColor}
        strokeWidth="3"
        opacity="0.25"
      />

      {/* EZ */}
      <text
        x="122"
        y="90"
        textAnchor="middle"
        fontFamily="'Pretendard', 'Apple SD Gothic Neo', sans-serif"
        fontWeight="800"
        fontSize="68"
        fill={textColor}
        letterSpacing="-2"
      >
        EZ
      </text>

      {/* LETTER */}
      <text
        x="122"
        y="140"
        textAnchor="middle"
        fontFamily="'Pretendard', 'Apple SD Gothic Neo', sans-serif"
        fontWeight="700"
        fontSize="38"
        fill={textColor}
        letterSpacing="4"
      >
        LETTER
      </text>
    </svg>
  );
}
