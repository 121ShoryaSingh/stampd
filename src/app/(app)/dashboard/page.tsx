import Link from "next/link";
import { requireTenant } from "@/server/tenants/current";
import { countByStatus, listEnvelopes } from "@/server/envelopes/service";
import type { EnvelopeStatus } from "@/server/db/types";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/app/status-pill";

const TABS: (EnvelopeStatus | "all")[] = ["all", "draft", "sent", "completed", "declined", "voided", "expired"];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { tenant } = await requireTenant();
  const { status } = await searchParams;
  const active = (TABS as string[]).includes(status ?? "") ? (status as EnvelopeStatus | "all") : "all";
  const [rows, counts] = await Promise.all([
    listEnvelopes(tenant.tenantId, active === "all" ? {} : { status: active }),
    countByStatus(tenant.tenantId),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl">Envelopes</h1>
          <p className="mt-2 font-mono text-sm">{tenant.name}</p>
        </div>
        <Link href="/envelopes/new" className="border-brutal shadow-hard-sm bg-red px-5 py-3 font-bold uppercase text-white">
          New envelope
        </Link>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === "all" ? "/dashboard" : `/dashboard?status=${t}`}
            className={`border-brutal px-3 py-1.5 font-mono text-xs font-bold uppercase ${active === t ? "bg-ink text-paper" : "bg-paper"}`}
          >
            {t} ({t === "all" ? total : counts[t]})
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card className="bg-yellow">
          <h2 className="font-display text-2xl">Nothing here yet.</h2>
          <p className="mt-2">Create an envelope, upload a PDF and send it for signature.</p>
        </Card>
      ) : (
        <Card className="p-0">
          <table className="w-full text-left">
            <thead className="border-b-[2.5px] border-ink font-mono text-xs uppercase">
              <tr>
                <th className="p-4">Title</th>
                <th className="p-4">Status</th>
                <th className="p-4">Signed</th>
                <th className="p-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-ink/20 hover:bg-yellow/40">
                  <td className="p-4 font-bold">
                    <Link href={`/envelopes/${e.id}`} className="hover:underline">
                      {e.title}
                    </Link>
                  </td>
                  <td className="p-4">
                    <StatusPill status={e.status} />
                  </td>
                  <td className="p-4 font-mono text-sm">
                    {e.signedCount}/{e.recipientCount}
                  </td>
                  <td className="p-4 font-mono text-sm">{e.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
