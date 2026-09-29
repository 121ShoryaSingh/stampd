import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Archive, ArchiveRestore, Copy } from "lucide-react";
import { requireTenant } from "@/server/tenants/current";
import { getPreset } from "@/server/presets/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/layout";
import { FieldEditor } from "@/components/app/field-editor";
import { archivePresetAction, duplicatePresetAction, restorePresetAction, savePresetFieldsAction } from "../actions";
import { InfoForm } from "./info-form";
import { RolesForm } from "./roles-form";
import { PresetUpload } from "./preset-upload";

export default async function PresetPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireTenant();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // Members only use presets; editing is for admins.
  if (tenant.role !== "admin") redirect(`/presets/${id}/use`);
  const { preset, roles, fields } = await getPreset(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const archived = preset.status === "archived";
  const pdfUrl = preset.s3Key ? await presignGet(preset.s3Key, 3600) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={preset.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <Badge tone={archived ? "paper" : "green"}>{preset.status}</Badge>
            <span className="font-mono text-sm">
              v{preset.version} - used {preset.usageCount} {preset.usageCount === 1 ? "time" : "times"}
            </span>
          </span>
        }
        actions={
          <>
            {!archived && (
              <Link href={`/presets/${id}/use`} className="border-brutal shadow-hard-sm press flex items-center gap-2 bg-yellow px-4 py-2.5 text-sm font-bold uppercase">
                Use preset
              </Link>
            )}
            <form action={duplicatePresetAction}>
              <input type="hidden" name="presetId" value={id} />
              <Button icon={<Copy aria-hidden className="h-4 w-4" />}>Duplicate</Button>
            </form>
            <form action={archived ? restorePresetAction : archivePresetAction}>
              <input type="hidden" name="presetId" value={id} />
              {archived ? (
                <Button icon={<ArchiveRestore aria-hidden className="h-4 w-4" />}>Restore</Button>
              ) : (
                <ConfirmSubmit icon={<Archive aria-hidden className="h-4 w-4" />} confirm={{ title: "Archive this preset?", message: "It is hidden from new envelopes. Envelopes already made from it are not affected, and you can restore it later.", confirmLabel: "Archive" }}>
                  Archive
                </ConfirmSubmit>
              )}
            </form>
          </>
        }
      />
      <Link href="/presets" className="font-bold underline">
        Back to presets
      </Link>

      <Card>
        <h2 className="mb-4 font-display text-2xl">1. Details</h2>
        <InfoForm presetId={id} initial={{ name: preset.name, description: preset.description ?? "", message: preset.message ?? "" }} />
      </Card>
      <Card>
        <h2 className="mb-4 font-display text-2xl">2. Document</h2>
        {preset.filename && (
          <p className="mb-3 font-mono text-sm">
            {preset.filename} - {preset.pageCount} {preset.pageCount === 1 ? "page" : "pages"}
          </p>
        )}
        <PresetUpload presetId={id} hasDocument={!!preset.s3Key} />
      </Card>
      <Card>
        <h2 className="mb-4 font-display text-2xl">3. Roles</h2>
        <RolesForm
          presetId={id}
          initial={roles.map((r) => ({ id: r.id, label: r.label, role: r.role, routingOrder: r.routingOrder, defaultName: r.defaultName ?? "", defaultEmail: r.defaultEmail ?? "" }))}
        />
      </Card>
      <Card>
        <h2 className="mb-4 font-display text-2xl">4. Place fields</h2>
        {pdfUrl ? (
          // A new PDF remounts the editor with the fields the server kept.
          <FieldEditor
            key={preset.s3Key}
            save={savePresetFieldsAction.bind(null, id)}
            pdfUrl={pdfUrl}
            pageSizes={preset.pageSizes}
            recipients={roles.map((r) => ({ id: r.id, name: r.label, email: "", role: r.role }))}
            initial={fields.map((f) => ({ key: f.id, recipientId: f.presetRoleId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, groupKey: f.groupKey, option: f.option, mark: f.mark }))}
            emptyText="Add at least one signer role above, then place its fields."
          />
        ) : (
          <p className="border-brutal bg-yellow p-4 font-bold">Upload a PDF first.</p>
        )}
      </Card>
    </div>
  );
}
