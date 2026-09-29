import Link from "next/link";
import { LayoutTemplate, Plus, Search } from "lucide-react";
import { requireTenant } from "@/server/tenants/current";
import { listPresets } from "@/server/presets/service";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, THead, TRow, TH, TD } from "@/components/ui/layout";

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "Never");

export default async function PresetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenant } = await requireTenant();
  const isAdmin = tenant.role === "admin";
  const sp = await searchParams;
  // Repeated query params arrive as arrays; only accept a single string.
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const q = one(sp.q);
  // Members only see active presets.
  const status = isAdmin && one(sp.status) === "archived" ? "archived" : "active";
  const rows = await listPresets(tenant.tenantId, { status, q });
  const tabHref = (s: string) => `/presets?${new URLSearchParams({ ...(s === "archived" ? { status: s } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Presets"
        subtitle={`Reusable documents for ${tenant.name}`}
        actions={
          isAdmin && (
            <Link href="/presets/new" className="border-brutal shadow-hard-sm press flex items-center gap-2 bg-red px-4 py-2.5 text-sm font-bold uppercase text-ink">
              <Plus aria-hidden className="h-4 w-4" /> New preset
            </Link>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <nav className="flex gap-2" aria-label="Filter presets">
            {["active", "archived"].map((s) => (
              <Link
                key={s}
                href={tabHref(s)}
                aria-current={status === s ? "page" : undefined}
                className={`border-brutal px-3 py-1.5 font-mono text-xs font-bold uppercase ${status === s ? "bg-ink text-paper" : "bg-paper hover:bg-yellow"}`}
              >
                {s}
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <form className="flex min-w-0 flex-1 basis-60 justify-end" role="search">
          {status === "archived" && <input type="hidden" name="status" value="archived" />}
          <label className="flex w-full max-w-xs items-center border-brutal bg-paper focus-within:bg-yellow">
            <Search aria-hidden className="ml-2 h-4 w-4 shrink-0" />
            <span className="sr-only">Search presets</span>
            <input name="q" defaultValue={q ?? ""} placeholder="Enter search" className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none" />
          </label>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate aria-hidden className="h-6 w-6" />}
          title={q ? "No matches." : status === "archived" ? "Nothing archived." : "No presets yet."}
          body={
            q
              ? `No preset names contain "${q}".`
              : status === "archived"
                ? "Archived presets show up here."
                : isAdmin
                  ? "Save a draft as a preset, or build one from a PDF, to reuse it for every deal."
                  : "Ask a workspace admin to create presets."
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Roles</TH>
              <TH className="hidden sm:table-cell">Used</TH>
              <TH className="hidden md:table-cell">Last used</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((p, i) => (
              <TRow key={p.id} className="rise hover:bg-yellow/30" style={{ "--i": i } as React.CSSProperties}>
                <TD>
                  {isAdmin ? (
                    <Link href={`/presets/${p.id}`} className="font-bold hover:underline">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="font-bold">{p.name}</span>
                  )}
                  <div className="font-mono text-xs">
                    v{p.version} - {p.pageCount} {p.pageCount === 1 ? "page" : "pages"} - {p.fieldCount} fields
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {p.roles.length ? p.roles.map((r) => <Badge key={r}>{r}</Badge>) : <span className="font-mono text-xs">No roles</span>}
                  </div>
                </TD>
                <TD className="hidden font-mono text-sm sm:table-cell">{p.usageCount}</TD>
                <TD className="hidden font-mono text-sm md:table-cell">{fmt(p.lastUsedAt)}</TD>
                <TD className="text-right">
                  {status === "active" && (
                    <Link href={`/presets/${p.id}/use`} aria-label={`Use ${p.name}`} className="border-brutal shadow-hard-sm press inline-flex bg-yellow px-3 py-1.5 text-xs font-bold uppercase">
                      Use
                    </Link>
                  )}
                </TD>
              </TRow>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
