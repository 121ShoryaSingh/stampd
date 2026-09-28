import { requireTenant } from "@/server/tenants/current";
import { AppShell } from "@/components/app/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant, tenants } = await requireTenant();
  return (
    <AppShell tenants={tenants} active={tenant} user={{ name: session.user.name, email: session.user.email }}>
      {children}
    </AppShell>
  );
}
