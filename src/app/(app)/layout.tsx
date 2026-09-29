import { cookies } from "next/headers";
import { requireTenant } from "@/server/tenants/current";
import { AppShell } from "@/components/app/shell";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-state";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant, tenants } = await requireTenant();
  // Collapsed or expanded, as the user left it.
  const sidebarOpen = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value !== "false";
  return (
    <AppShell tenants={tenants} active={tenant} user={{ name: session.user.name, email: session.user.email }} sidebarOpen={sidebarOpen}>
      {children}
    </AppShell>
  );
}
