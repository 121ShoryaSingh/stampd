"use client";

import { switchWorkspaceAction } from "@/app/(app)/actions";
import type { UserTenant } from "@/server/tenants/pick";

export function WorkspaceSwitcher({ tenants, activeId }: { tenants: UserTenant[]; activeId: string }) {
  return (
    <form action={switchWorkspaceAction}>
      <label className="block font-mono text-[10px] font-bold uppercase">
        Workspace
        <select
          name="tenantId"
          defaultValue={activeId}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="border-brutal mt-1 w-full bg-yellow px-2 py-2 font-sans text-sm font-bold normal-case"
        >
          {tenants.map((t) => (
            <option key={t.tenantId} value={t.tenantId}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
