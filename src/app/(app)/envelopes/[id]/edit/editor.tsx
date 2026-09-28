"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfCanvas } from "./pdf-canvas";
import { saveFieldsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { clampBox, DEFAULT_FIELD_SIZE, type Box, type FieldKind } from "@/lib/fields/geometry";

type Recipient = { id: string; name: string; email: string; role: "signer" | "cc" };
type EditorField = Box & { key: string; recipientId: string; type: FieldKind; page: number };
type PageSize = { w: number; h: number };
type Drag = { key: string; mode: "move" | "resize"; startX: number; startY: number; orig: Box; pageW: number; pageH: number };

const KINDS: { type: FieldKind; label: string }[] = [
  { type: "signature", label: "Signature" },
  { type: "initials", label: "Initials" },
  { type: "date", label: "Date" },
  { type: "text", label: "Text" },
  { type: "checkbox", label: "Checkbox" },
];
const COLORS = ["#FFE600", "#FF8AD8", "#00D26A", "#7FA8FF", "#FF9A6B"];
const PAGE_W = 760;

export function FieldEditor(props: { envelopeId: string; pdfUrl: string; pageSizes: PageSize[]; recipients: Recipient[]; initial: EditorField[] }) {
  const signers = props.recipients.filter((r) => r.role === "signer");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fields, setFields] = useState<EditorField[]>(props.initial);
  const [tool, setTool] = useState<FieldKind | null>(null);
  const [picked, setAssignee] = useState(signers[0]?.id ?? "");
  // Signers can change after load (recipients saved above), so fall back to the first one.
  const assignee = signers.some((s) => s.id === picked) ? picked : (signers[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const drag = useRef<Drag | null>(null);
  const color = (rid: string) => COLORS[Math.max(0, signers.findIndex((s) => s.id === rid)) % COLORS.length];

  useEffect(() => {
    let alive = true;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // copied into public/ on install
      const d = await pdfjs.getDocument({ url: props.pdfUrl }).promise;
      if (alive) setDoc(d);
    })().catch(() => setMsg({ error: "Could not load the PDF preview" }));
    return () => {
      alive = false;
    };
  }, [props.pdfUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !typing) {
        setFields((fs) => fs.filter((f) => f.key !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function place(e: React.MouseEvent<HTMLDivElement>, page: number) {
    if (!tool || !assignee || e.target !== e.currentTarget.firstChild) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const size = DEFAULT_FIELD_SIZE[tool];
    const box = clampBox({ x: (e.clientX - rect.left) / rect.width - size.w / 2, y: (e.clientY - rect.top) / rect.height - size.h / 2, ...size });
    const f = { ...box, key: crypto.randomUUID(), recipientId: assignee, type: tool, page };
    setFields((fs) => [...fs, f]);
    setSelected(f.key);
  }

  function startDrag(e: React.PointerEvent, f: EditorField, mode: Drag["mode"]) {
    e.stopPropagation();
    const pageEl = (e.currentTarget as HTMLElement).closest("[data-page]") as HTMLElement;
    const r = pageEl.getBoundingClientRect();
    drag.current = { key: f.key, mode, startX: e.clientX, startY: e.clientY, orig: { x: f.x, y: f.y, w: f.w, h: f.h }, pageW: r.width, pageH: r.height };
    setSelected(f.key);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.pageW;
    const dy = (e.clientY - d.startY) / d.pageH;
    const next = d.mode === "move" ? { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy } : { ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy };
    setFields((fs) => fs.map((f) => (f.key === d.key ? { ...f, ...clampBox(next) } : f)));
  }

  async function save() {
    setMsg({});
    const res = await saveFieldsAction(
      props.envelopeId,
      fields.map(({ key: _key, ...f }) => f),
    );
    setMsg(res.error ? { error: res.error } : { ok: `Saved ${res.count} fields` });
  }

  if (signers.length === 0) {
    return <p className="border-brutal bg-yellow p-4 font-bold">Add at least one signer above, then place their fields.</p>;
  }

  return (
    <div className="grid grid-cols-[14rem_1fr] gap-6" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <aside className="sticky top-4 h-fit space-y-4">
        <label className="block">
          <span className="mb-1 block font-mono text-xs font-bold uppercase">Assign to</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="border-brutal w-full px-2 py-2 font-bold" style={{ background: color(assignee) }}>
            {signers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-2">
          {KINDS.map((k) => (
            <button
              key={k.type}
              type="button"
              aria-pressed={tool === k.type}
              onClick={() => setTool(tool === k.type ? null : k.type)}
              className={`border-brutal px-3 py-2 text-left font-bold ${tool === k.type ? "bg-ink text-paper" : "bg-paper hover:bg-yellow"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-xs">Pick a field type, then click on the page. Drag to move, drag the corner to resize, Delete to remove.</p>
        <Button variant="primary" type="button" onClick={save} className="w-full justify-center">
          Save fields
        </Button>
        {msg.error && <p role="alert" className="border-brutal bg-red p-2 text-sm font-bold text-white">{msg.error}</p>}
        {msg.ok && <p role="status" className="border-brutal bg-green p-2 text-sm font-bold">{msg.ok}</p>}
      </aside>
      <div className="space-y-6">
        {!doc && <p className="font-mono">Loading PDF...</p>}
        {doc &&
          props.pageSizes.map((ps, i) => {
            const page = i + 1;
            const h = (ps.h / ps.w) * PAGE_W;
            return (
              <div
                key={page}
                data-page={page}
                data-testid={`page-${page}`}
                onClick={(e) => place(e, page)}
                className={`border-brutal shadow-hard relative bg-paper ${tool ? "cursor-crosshair" : ""}`}
                style={{ width: PAGE_W, height: h }}
              >
                <PdfCanvas doc={doc} pageNumber={page} width={PAGE_W} />
                {fields
                  .filter((f) => f.page === page)
                  .map((f) => (
                    <div
                      key={f.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${f.type} field`}
                      onPointerDown={(e) => startDrag(e, f, "move")}
                      className={`absolute flex cursor-move select-none items-center border-2 border-ink px-1 font-mono text-[10px] font-bold uppercase ${selected === f.key ? "outline outline-2 outline-offset-2 outline-red" : ""}`}
                      style={{ left: f.x * PAGE_W, top: f.y * h, width: f.w * PAGE_W, height: f.h * h, background: color(f.recipientId) }}
                    >
                      {f.type}
                      <span
                        onPointerDown={(e) => startDrag(e, f, "resize")}
                        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize border-2 border-ink bg-paper"
                      />
                    </div>
                  ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
