"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePresetInfoAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";

type Info = { name: string; description: string; message: string };

export function InfoForm({ presetId, initial }: { presetId: string; initial: Info }) {
  const router = useRouter();
  const [info, setInfo] = useState(initial);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await updatePresetInfoAction(presetId, { name: info.name, description: info.description || null, message: info.message || null });
    setBusy(false);
    if (res.error) return setMsg({ error: res.error });
    setMsg({ ok: "Details saved" });
    router.refresh();
  }

  return (
    <div className="max-w-xl space-y-4">
      <Input label="Name" value={info.name} maxLength={80} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
      <Textarea label="Description" value={info.description} maxLength={500} rows={2} onChange={(e) => setInfo({ ...info, description: e.target.value })} />
      <Textarea label="Message to signers" hint="Goes into every envelope made from this preset." value={info.message} maxLength={2000} rows={3} onChange={(e) => setInfo({ ...info, message: e.target.value })} />
      <Button type="button" variant="accent" onClick={save} disabled={busy}>
        {busy ? "Saving..." : "Save details"}
      </Button>
      {msg.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{msg.error}</p>}
      {msg.ok && <p role="status" className="border-brutal bg-green p-2 font-bold">{msg.ok}</p>}
    </div>
  );
}
