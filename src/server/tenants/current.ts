import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { listUserTenants } from "./service";
import { pickActiveTenant } from "./pick";

export const TENANT_COOKIE = "stampd_tenant";

export async function requireTenant() {
  const session = await requireSession();
  const tenants = await listUserTenants(session.user.id);
  const tenant = pickActiveTenant(tenants, (await cookies()).get(TENANT_COOKIE)?.value);
  if (!tenant) redirect("/onboarding");
  return { session, tenant, tenants };
}

export async function setActiveTenantCookie(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
