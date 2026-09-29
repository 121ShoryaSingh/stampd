"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { saveAsPresetAction } from "@/app/(app)/presets/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";

// Saves this draft's PDF, recipients (as roles) and fields as a workspace preset.
export function SavePresetButton({ envelopeId, title, presets }: { envelopeId: string; title: string; presets: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveAsPresetAction.bind(null, envelopeId), {});
  return (
    <>
      <Button icon={<LayoutTemplate aria-hidden className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Save as preset
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Save as preset">
        {state.id ? (
          <div className="space-y-4">
            <p role="status" className="border-brutal bg-green p-3 font-bold">
              Preset saved.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Link href={`/presets/${state.id}`} className="border-brutal shadow-hard-sm press bg-yellow px-4 py-2 font-bold uppercase">
                Open preset
              </Link>
            </div>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <p>Recipients become roles, with their names and emails as defaults. Everyone in this workspace can use the preset.</p>
            <Input label="Preset name" name="name" required maxLength={80} defaultValue={title.slice(0, 80)} />
            {presets.length > 0 && (
              <Select label="Save to" name="replacePresetId" defaultValue="">
                <option value="">A new preset</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    Replace {p.name}
                  </option>
                ))}
              </Select>
            )}
            {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={pending}>
                {pending ? "Saving..." : "Save preset"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
