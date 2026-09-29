import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { requireTenant } from "@/server/tenants/current";
import { listPresets } from "@/server/presets/service";
import { Card } from "@/components/ui/card";
import { NewEnvelopeForm } from "./new-form";

export default async function NewEnvelopePage() {
  const { tenant } = await requireTenant();
  const presets = (await listPresets(tenant.tenantId)).filter((p) => p.hasDocument).slice(0, 8);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]">
      <NewEnvelopeForm />
      {presets.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-2 font-display text-2xl">
            <LayoutTemplate aria-hidden className="h-5 w-5" /> Start from a preset
          </h2>
          <ul className="mt-4 space-y-2">
            {presets.map((p) => (
              <li key={p.id}>
                <Link href={`/presets/${p.id}/use`} className="border-brutal press flex items-center justify-between gap-3 bg-paper px-3 py-2 hover:bg-yellow">
                  <span className="font-bold">{p.name}</span>
                  <span className="font-mono text-xs">{p.roles.join(", ")}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/presets" className="mt-3 inline-block font-bold underline">
            All presets
          </Link>
        </Card>
      )}
    </div>
  );
}
