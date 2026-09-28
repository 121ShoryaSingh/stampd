import { requireTenant } from "@/server/tenants/current";
import { Card } from "@/components/ui/card";

export default async function DashboardPage() {
  const { tenant } = await requireTenant();
  return (
    <div>
      <h1 className="font-display text-5xl">Envelopes</h1>
      <p className="mt-2 font-mono text-sm">{tenant.name}</p>
      <Card className="mt-8 bg-yellow">
        <h2 className="font-display text-2xl">Nothing sent yet.</h2>
        <p className="mt-2">Upload a PDF to send your first envelope.</p>
      </Card>
    </div>
  );
}
