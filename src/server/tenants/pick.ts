import type { Role } from "@/server/db/schema";

export type UserTenant = { tenantId: string; name: string; slug: string; role: Role };

// A cookie for a workspace the user is not in is ignored.
export function pickActiveTenant(tenants: UserTenant[], cookieValue: string | undefined): UserTenant | null {
  return tenants.find((t) => t.tenantId === cookieValue) ?? tenants[0] ?? null;
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "workspace";
}
