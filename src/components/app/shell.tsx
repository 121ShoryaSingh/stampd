"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSignature, LayoutTemplate, Plus, Users } from "lucide-react";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";
import { ToastProvider } from "@/components/ui/toast";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/shadcn/sidebar";
import type { UserTenant } from "@/server/tenants/pick";

const NAV = [
  { href: "/dashboard", label: "Envelopes", Icon: FileSignature, match: ["/dashboard", "/envelopes"] },
  { href: "/presets", label: "Presets", Icon: LayoutTemplate, match: ["/presets"] },
  { href: "/settings/team", label: "Team", Icon: Users, match: ["/settings/team"] },
];

function AppSidebar({ tenants, active }: { tenants: UserTenant[]; active: UserTenant }) {
  const path = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  // On phones the sidebar is a sheet: close it once a link is followed.
  const done = () => isMobile && setOpenMobile(false);
  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/dashboard" onClick={done} className="flex items-center gap-2 font-display text-2xl group-data-[collapsible=icon]:justify-center" aria-label="Stampd home">
          <i aria-hidden className="border-brutal inline-block h-6 w-6 shrink-0 rotate-6 bg-red" />
          <span className="group-data-[collapsible=icon]:hidden">Stampd</span>
        </Link>
        <div className="group-data-[collapsible=icon]:hidden">
          <WorkspaceSwitcher tenants={tenants} activeId={active.tenantId} />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="New envelope"
              className="border-brutal shadow-hard-sm press justify-center border-l-[2.5px] bg-red py-2.5 text-sm uppercase text-ink hover:bg-red group-data-[collapsible=icon]:border-l-[2.5px]"
            >
              <Link href="/envelopes/new" onClick={done}>
                <Plus aria-hidden />
                <span>New envelope</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main">
          <SidebarMenu>
            {NAV.map(({ href, label, Icon, match }) => {
              const current = match.some((m) => path === m || path.startsWith(`${m}/`));
              return (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={current} tooltip={label}>
                    <Link href={href} onClick={done} aria-current={current ? "page" : undefined}>
                      <Icon aria-hidden />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

export function AppShell(props: { tenants: UserTenant[]; active: UserTenant; user: { name: string; email: string }; sidebarOpen: boolean; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SidebarProvider defaultOpen={props.sidebarOpen}>
        <AppSidebar tenants={props.tenants} active={props.active} />
        <SidebarInset>
          <header className="flex items-center justify-between gap-3 border-b-[2.5px] border-ink bg-paper px-4 py-3 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger />
              <span className="truncate font-mono text-xs font-bold uppercase">{props.active.name}</span>
            </div>
            <UserMenu name={props.user.name} email={props.user.email} role={props.active.role} />
          </header>
          <div className="min-w-0 flex-1 bg-[#FAFAFA] p-4 md:p-8">{props.children}</div>
        </SidebarInset>
      </SidebarProvider>
    </ToastProvider>
  );
}
