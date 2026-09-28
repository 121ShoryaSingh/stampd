"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSignature, Menu, Plus, Users } from "lucide-react";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";
import { Modal } from "@/components/ui/modal";
import { ToastProvider } from "@/components/ui/toast";
import type { UserTenant } from "@/server/tenants/pick";

const NAV = [
  { href: "/dashboard", label: "Envelopes", Icon: FileSignature, match: ["/dashboard", "/envelopes"] },
  { href: "/settings/team", label: "Team", Icon: Users, match: ["/settings/team"] },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map(({ href, label, Icon, match }) => {
        const active = match.some((m) => path === m || path.startsWith(`${m}/`));
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 border-l-4 px-3 py-2 font-bold transition-colors ${active ? "border-ink bg-yellow" : "border-transparent hover:bg-yellow/50"}`}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarBody({ tenants, active, onNavigate }: { tenants: UserTenant[]; active: UserTenant; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 font-display text-2xl">
        <i className="border-brutal inline-block h-6 w-6 rotate-6 bg-red" />
        Stampd
      </Link>
      <WorkspaceSwitcher tenants={tenants} activeId={active.tenantId} />
      <Link href="/envelopes/new" onClick={onNavigate} className="border-brutal shadow-hard-sm press flex items-center justify-center gap-2 bg-red px-4 py-2.5 text-sm font-bold uppercase text-ink">
        <Plus aria-hidden className="h-4 w-4" />
        New envelope
      </Link>
      <nav aria-label="Main">
        <NavLinks onNavigate={onNavigate} />
      </nav>
    </div>
  );
}

export function AppShell(props: { tenants: UserTenant[]; active: UserTenant; user: { name: string; email: string }; children: React.ReactNode }) {
  const path = usePathname();
  // The drawer belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (v: boolean) => setOpenOn(v ? path : null);

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r-[2.5px] border-ink bg-paper p-5 md:block">
          <div className="sticky top-5">
            <SidebarBody tenants={props.tenants} active={props.active} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b-[2.5px] border-ink bg-paper px-4 py-3 md:px-8">
            <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="border-brutal p-2 md:hidden">
              <Menu aria-hidden className="h-5 w-5" />
            </button>
            <span className="truncate font-mono text-xs font-bold uppercase">{props.active.name}</span>
            <UserMenu name={props.user.name} email={props.user.email} role={props.active.role} />
          </header>
          <main className="min-w-0 flex-1 bg-[#FAFAFA] p-4 md:p-8">{props.children}</main>
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Menu">
        <SidebarBody tenants={props.tenants} active={props.active} onNavigate={() => setOpen(false)} />
      </Modal>
    </ToastProvider>
  );
}
