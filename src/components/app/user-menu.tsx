"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { logoutAction } from "@/app/(app)/logout-action";

export function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus(); // keep keyboard users where they were
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button ref={trigger} type="button" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 px-1 py-1 hover:bg-yellow">
        <span className="border-brutal grid h-8 w-8 place-items-center bg-pink font-display text-xs">{initials}</span>
        <ChevronDown aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <div className="border-brutal shadow-hard pop absolute right-0 z-40 mt-2 w-64 bg-paper">
          <div className="border-b-[2.5px] border-ink p-3">
            <p className="truncate font-bold">{name}</p>
            <p className="truncate font-mono text-xs">{email}</p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase">{role}</p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="flex w-full items-center gap-2 p-3 text-left font-bold hover:bg-yellow">
              <LogOut aria-hidden className="h-4 w-4" />
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
