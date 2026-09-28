import Link from "next/link";
import { ArrowRight, FilePlus2, Plus, Search } from "lucide-react";
import { requireTenant } from "@/server/tenants/current";
import { countByStatus, listEnvelopes } from "@/server/envelopes/service";
import type { EnvelopeStatus } from "@/server/db/types";
import { StatusPill } from "@/components/app/status-pill";
import { EmptyState, PageHeader, StatTile, Table, THead, TRow, TH, TD } from "@/components/ui/layout";

const TABS: (EnvelopeStatus | "all")[] = ["all", "draft", "sent", "completed", "declined", "voided", "expired"];
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { tenant } = await requireTenant();
  const { status, q } = await searchParams;
  const active = (TABS as string[]).includes(status ?? "") ? (status as EnvelopeStatus | "all") : "all";
  const [rows, counts] = await Promise.all([
    listEnvelopes(tenant.tenantId, { ...(active === "all" ? {} : { status: active }), q }),
    countByStatus(tenant.tenantId),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabHref = (t: string) => `/dashboard?${new URLSearchParams({ ...(t !== "all" ? { status: t } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Envelopes"
        subtitle={tenant.name}
        actions={
          // The sidebar has this button on desktop; phones get it here.
          <Link href="/envelopes/new" className="border-brutal shadow-hard-sm press flex items-center gap-2 bg-red px-4 py-2.5 text-sm font-bold uppercase text-ink md:hidden">
            <Plus aria-hidden className="h-4 w-4" /> New envelope
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Awaiting signature" value={counts.sent} tone="bg-yellow" />
        <StatTile index={1} label="Completed" value={counts.completed} tone="bg-green" />
        <StatTile index={2} label="Drafts" value={counts.draft} />
        <StatTile index={3} label="Needs attention" value={counts.declined + counts.expired} tone="bg-pink" hint="Declined or expired" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
          {TABS.map((t) => (
            <Link
              key={t}
              href={tabHref(t)}
              aria-current={active === t ? "page" : undefined}
              className={`border-brutal px-3 py-1.5 font-mono text-xs font-bold uppercase transition-colors ${active === t ? "bg-ink text-paper" : "bg-paper hover:bg-yellow"}`}
            >
              {t} ({t === "all" ? total : counts[t]})
            </Link>
          ))}
        </nav>
        <form className="flex min-w-0 flex-1 basis-60 justify-end" role="search">
          {active !== "all" && <input type="hidden" name="status" value={active} />}
          <label className="flex w-full max-w-xs items-center border-brutal bg-paper focus-within:bg-yellow">
            <Search aria-hidden className="ml-2 h-4 w-4 shrink-0" />
            <span className="sr-only">Search envelopes</span>
            <input name="q" defaultValue={q ?? ""} placeholder="Enter search" className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none" />
          </label>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FilePlus2 aria-hidden className="h-6 w-6" />}
          title={q ? "No matches." : total === 0 ? "Nothing sent yet." : "Nothing here."}
          body={q ? `No envelope titles contain "${q}".` : total === 0 ? "Create an envelope, upload a PDF and send it for signature." : "No envelopes with this status."}
          action={
            total === 0 ? (
              <Link href="/envelopes/new" className="border-brutal shadow-hard-sm press bg-yellow px-4 py-2 font-bold uppercase">
                Create your first envelope
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH>Signers</TH>
              <TH className="hidden sm:table-cell">Sent</TH>
              <TH>
                <span className="sr-only">Open</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((e, i) => {
              const pct = e.recipientCount ? Math.round((e.signedCount / e.recipientCount) * 100) : 0;
              return (
                <TRow key={e.id} className="rise hover:bg-yellow/30" style={{ "--i": i } as React.CSSProperties}>
                  <TD className="font-bold">
                    <Link href={`/envelopes/${e.id}`} className="hover:underline">
                      {e.title}
                    </Link>
                  </TD>
                  <TD>
                    <StatusPill status={e.status} />
                  </TD>
                  <TD>
                    <div className="flex min-w-28 items-center gap-2">
                      <div className="border-brutal h-3 flex-1 bg-paper" aria-hidden>
                        <div className="h-full bg-green" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono text-xs">
                        {e.signedCount}/{e.recipientCount}
                      </span>
                    </div>
                  </TD>
                  <TD className="hidden font-mono text-sm sm:table-cell">{fmt(e.sentAt)}</TD>
                  <TD className="text-right">
                    <Link href={`/envelopes/${e.id}`} aria-label={`Open ${e.title}`} className="inline-flex p-1 hover:bg-yellow">
                      <ArrowRight aria-hidden className="h-4 w-4" />
                    </Link>
                  </TD>
                </TRow>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
