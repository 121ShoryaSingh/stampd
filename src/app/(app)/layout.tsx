import { requireTenant } from "@/server/tenants/current";
import { Sidebar } from "@/components/app/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant, tenants } = await requireTenant();
  return (
    <div className="flex min-h-screen">
      <Sidebar tenants={tenants} active={tenant} userEmail={session.user.email} />
      <main className="flex-1 bg-[#FAFAFA] p-8">{children}</main>
    </div>
  );
}
