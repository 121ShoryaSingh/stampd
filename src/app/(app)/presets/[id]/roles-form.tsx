"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { savePresetRolesAction } from "../actions";
import { Button } from "@/components/ui/button";

type Row = { id?: string; label: string; role: "signer" | "cc"; routingOrder: number; defaultName: string; defaultEmail: string };

export function RolesForm({ presetId, initial }: { presetId: string; initial: Row[] }) {
  const router = useRouter();
  const blank = (n: number): Row => ({ label: "", role: "signer", routingOrder: n, defaultName: "", defaultEmail: "" });
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [blank(1)]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  // Swaps two rows and their signing order, so the list order matches who signs first.
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [{ ...rs[j], routingOrder: rs[i].routingOrder }, { ...rs[i], routingOrder: rs[j].routingOrder }];
      return next;
    });
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  async function save() {
    setBusy(true);
    const res = await savePresetRolesAction(presetId, rows.map((r) => ({ ...r, defaultName: r.defaultName || null, defaultEmail: r.defaultEmail || null })));
    setBusy(false);
    if (res.error) return setMsg({ error: res.error });
    // New rows now have ids, so later saves keep their fields.
    const saved = res.saved ?? [];
    setRows((rs) => rs.map((r, i) => ({ ...r, id: saved[i]?.id ?? r.id })));
    setMsg({ ok: "Roles saved" });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className="border-brutal grid grid-cols-1 gap-2 bg-paper p-2 sm:grid-cols-[1fr_7rem_5rem_auto] lg:grid-cols-[1fr_1fr_1.3fr_7rem_5rem_auto]">
          <input aria-label={`Role ${i + 1} name`} placeholder="Enter role name" value={r.label} onChange={(e) => update(i, { label: e.target.value })} className="border-brutal px-2 py-2" />
          <input
            aria-label={`Role ${i + 1} default person`}
            placeholder="Enter default person"
            value={r.defaultName}
            onChange={(e) => update(i, { defaultName: e.target.value })}
            className="border-brutal px-2 py-2"
          />
          <input
            aria-label={`Role ${i + 1} default email`}
            placeholder="Enter default email"
            type="email"
            value={r.defaultEmail}
            onChange={(e) => update(i, { defaultEmail: e.target.value })}
            className="border-brutal px-2 py-2"
          />
          <select aria-label={`Role ${i + 1} type`} value={r.role} onChange={(e) => update(i, { role: e.target.value as Row["role"] })} className="border-brutal px-2 py-2">
            <option value="signer">Signer</option>
            <option value="cc">CC</option>
          </select>
          <input
            aria-label={`Role ${i + 1} order`}
            type="number"
            min={1}
            max={20}
            value={r.routingOrder}
            onChange={(e) => update(i, { routingOrder: Number(e.target.value) })}
            className="border-brutal px-2 py-2"
          />
          <div className="flex gap-1">
            <button type="button" aria-label={`Move role ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className="border-brutal p-2 disabled:opacity-30">
              <ArrowUp aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`Move role ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="border-brutal p-2 disabled:opacity-30">
              <ArrowDown aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`Remove role ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="border-brutal p-2">
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
      <p className="font-mono text-xs">A role is a slot like Client or Manager. Defaults are prefilled when the preset is used. Same order number = sign in parallel.</p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => setRows((rs) => [...rs, blank(rs.length + 1)])}>
          Add role
        </Button>
        <Button type="button" variant="accent" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save roles"}
        </Button>
      </div>
      {msg.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{msg.error}</p>}
      {msg.ok && <p role="status" className="border-brutal bg-green p-2 font-bold">{msg.ok}</p>}
    </div>
  );
}
