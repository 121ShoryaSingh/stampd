"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRecipientsAction } from "./actions";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Row = { name: string; email: string; role: "signer" | "cc"; routingOrder: number };

export function RecipientsForm({ envelopeId, initial }: { envelopeId: string; initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [{ name: "", email: "", role: "signer", routingOrder: 1 }]);
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
    const res = await saveRecipientsAction(envelopeId, rows);
    setBusy(false);
    if (res.error) return setMsg({ error: res.error });
    setMsg({ ok: "Recipients saved" });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="border-brutal rise grid grid-cols-1 gap-2 bg-paper p-2 sm:grid-cols-[1fr_1.4fr_7rem_5rem_auto]" style={{ "--i": i } as React.CSSProperties}>
          <input aria-label={`Recipient ${i + 1} name`} placeholder="Enter name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} className="border-brutal px-2 py-2" />
          <input
            aria-label={`Recipient ${i + 1} email`}
            placeholder="Enter email"
            type="email"
            value={r.email}
            onChange={(e) => update(i, { email: e.target.value })}
            className="border-brutal px-2 py-2"
          />
          <select aria-label={`Recipient ${i + 1} role`} value={r.role} onChange={(e) => update(i, { role: e.target.value as Row["role"] })} className="border-brutal px-2 py-2">
            <option value="signer">Signer</option>
            <option value="cc">CC</option>
          </select>
          <input
            aria-label={`Recipient ${i + 1} order`}
            type="number"
            min={1}
            max={20}
            value={r.routingOrder}
            onChange={(e) => update(i, { routingOrder: Number(e.target.value) })}
            className="border-brutal px-2 py-2"
          />
          <div className="flex gap-1">
            <button type="button" aria-label={`Move recipient ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className="border-brutal p-2 disabled:opacity-30">
              <ArrowUp aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`Move recipient ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="border-brutal p-2 disabled:opacity-30">
              <ArrowDown aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`Remove recipient ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="border-brutal p-2">
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
      <p className="font-mono text-xs">Same order number = sign in parallel. Lower numbers sign first.</p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => setRows((rs) => [...rs, { name: "", email: "", role: "signer", routingOrder: rs.length + 1 }])}>
          Add recipient
        </Button>
        <Button type="button" variant="accent" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save recipients"}
        </Button>
      </div>
      {msg.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{msg.error}</p>}
      {msg.ok && <p role="status" className="border-brutal bg-green p-2 font-bold">{msg.ok}</p>}
    </div>
  );
}
