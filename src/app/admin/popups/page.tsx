"use client";

import PopupManager from "@/components/admin/PopupManager";

export default function PopupsPage() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <p className="text-[0.68rem] font-semibold tracking-[0.08em] uppercase m-0 mb-1"
          style={{ color: "var(--on-surface-variant)" }}>
          SITE BANNER
        </p>
        <h1 className="text-xl font-bold tracking-tight m-0">팝업 관리</h1>
        <p className="text-xs m-0 mt-1" style={{ color: "var(--on-surface-variant)" }}>
          뉴스룸에 노출되는 이벤트·공지 배너를 등록하고 노출 페이지·게시기간을 관리합니다
        </p>
      </div>
      <PopupManager />
    </div>
  );
}
