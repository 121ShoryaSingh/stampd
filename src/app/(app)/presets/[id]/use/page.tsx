import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { getPreset } from "@/server/presets/service";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { UseForm } from "./use-form";

export default async function UsePresetPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireTenant();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { preset, roles } = await getPreset(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <Card className="max-w-2xl">
      <h1 className="font-display text-4xl">{preset.name}.</h1>
      {preset.description && <p className="mt-2">{preset.description}</p>}
      <p className="mt-2 font-mono text-sm">
        Fill in who takes each role. You can review the draft before sending.{" "}
        <Link href="/presets" className="font-bold underline">
          Back to presets
        </Link>
      </p>
      {preset.status === "archived" ? (
        <p role="alert" className="border-brutal mt-6 bg-yellow p-4 font-bold">
          This preset is archived. Restore it to use it.
        </p>
      ) : (
        <UseForm
          presetId={id}
          defaultTitle={preset.name}
          roles={roles.map((r) => ({ id: r.id, label: r.label, role: r.role, routingOrder: r.routingOrder, defaultName: r.defaultName ?? "", defaultEmail: r.defaultEmail ?? "" }))}
        />
      )}
    </Card>
  );
}
