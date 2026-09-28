import Link from "next/link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { UserTenant } from "@/server/tenants/pick";

const nav = [
  { href: "/dashboard", label: "Envelopes" },
  { href: "/settings/team", label: "Team" },
];

export function Sidebar({ tenants, active, userEmail }: { tenants: UserTenant[]; active: UserTenant; userEmail: string }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-6 border-r-[2.5px] border-ink bg-paper p-5">
      <Link href="/dashboard" className="flex items-center gap-2 font-display text-2xl">
        <i className="border-brutal inline-block h-6 w-6 rotate-6 bg-red" />
        Stampd
      </Link>
      <WorkspaceSwitcher tenants={tenants} activeId={active.tenantId} />
      <nav className="flex flex-col gap-1">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="px-2 py-2 font-bold hover:bg-yellow">
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto font-mono text-xs">
        <p className="truncate">{userEmail}</p>
        <p className="uppercase">{active.role}</p>
      </div>
    </aside>
  );
}
