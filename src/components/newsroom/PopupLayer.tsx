"use client";

import PopupBanner, { type PopupData } from "./PopupBanner";

export default function PopupLayer({ popups, pageKey }: { popups: PopupData[]; pageKey: string }) {
  return (
    <>
      {popups.map((p) => (
        <PopupBanner key={p.id} popup={p} pageKey={pageKey} />
      ))}
    </>
  );
}
