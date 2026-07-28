"use client";

import { useEffect } from "react";
import { logEvent } from "@/lib/analytics";

export default function LogNewsletterIssueView({ vol }: { vol: number }) {
  useEffect(() => {
    logEvent({ event_type: "newsletter_archive_view", newsletter_vol: vol });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vol]);
  return null;
}
