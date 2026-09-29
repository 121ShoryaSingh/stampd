"use client";

import { useEffect } from "react";

// Shown once after sending; drops ?sent=1 so a reload does not announce it again.
export function SentNotice() {
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.delete("sent");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }, []);
  return (
    <p role="status" className="border-brutal bg-green p-3 font-bold">
      Sent. Signing emails are on their way.
    </p>
  );
}
