"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm";

// While `dirty`, leaving asks first: in-app links get our own dialog, closing or reloading the tab gets the
// browser's prompt (pages cannot replace that one). Render the returned dialog.
export function useLeaveGuard(dirty: boolean, what: string) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // App Router links skip beforeunload, so catch their clicks.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const to = new URL(link.href, location.href);
      void confirm({
        title: "Leave without saving?",
        message: `You have unsaved ${what}. If you leave now, they are lost.`,
        confirmLabel: "Leave without saving",
        cancelLabel: "Stay here",
        tone: "danger",
      }).then((leave) => {
        if (!leave) return;
        if (to.origin === location.origin) router.push(to.pathname + to.search + to.hash);
        else location.assign(to.href);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, what, confirm, router]);

  return dialog;
}
