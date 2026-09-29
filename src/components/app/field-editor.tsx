"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, CheckSquare, CircleDot, Crosshair, GripVertical, PenLine, Signature, TextCursorInput } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfCanvas } from "@/components/pdf/pdf-canvas";
import { Button } from "@/components/ui/button";
import { clampBox, DEFAULT_FIELD_SIZE, type Box, type FieldKind } from "@/lib/fields/geometry";
import { pruneOrphanFields } from "@/lib/fields/prune";
import { alignToOthers, gridStepFor, moveBox, resizeBox, GRID_MAJOR_EVERY, GRID_STEP as BASE_GRID_STEP, type Guides, type Handle } from "@/lib/fields/snap";

type Recipient = { id: string; name: string; email: string; role: "signer" | "cc" };
type EditorField = Box & { key: string; recipientId: string; type: FieldKind; page: number; required?: boolean };
type PageSize = { w: number; h: number };
type FieldDrag = { kind: "field"; key: string; handle: Handle | "move"; startX: number; startY: number; orig: Box; pageW: number; pageH: number };
type PaletteDrag = { kind: "palette"; type: FieldKind; startX: number; startY: number; x: number; y: number; moved: boolean };

const KINDS: { type: FieldKind; label: string; Icon: typeof PenLine }[] = [
  { type: "signature", label: "Signature", Icon: Signature },
  { type: "initials", label: "Initials", Icon: PenLine },
  { type: "date", label: "Date", Icon: Calendar },
  { type: "text", label: "Text", Icon: TextCursorInput },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare },
  { type: "choice", label: "Yes / No", Icon: CircleDot },
];
const HANDLES: { h: Handle; cls: string }[] = [
  { h: "nw", cls: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { h: "n", cls: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
  { h: "ne", cls: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { h: "e", cls: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { h: "se", cls: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  { h: "s", cls: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { h: "sw", cls: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { h: "w", cls: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
];
const COLORS = ["#FFE600", "#FF8AD8", "#00D26A", "#7FA8FF", "#FF9A6B"];
const BASE_W = 760;
const ZOOMS = [75, 100, 125, 150, 200, 300, 400];
const ALIGN_PX = 5;
const NO_GUIDES: Guides = { v: [], h: [] };

export type SavedField = Omit<EditorField, "key">;

// Shared by envelopes (people = recipients) and presets (people = roles).
export function FieldEditor(props: {
  save: (list: SavedField[]) => Promise<{ count?: number; error?: string }>;
  pdfUrl: string;
  pageSizes: PageSize[];
  recipients: Recipient[];
  initial: EditorField[];
  emptyText?: string;
}) {
  const signers = props.recipients.filter((r) => r.role === "signer");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [allFields, setAllFields] = useState<EditorField[]>(props.initial);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(100);
  const PAGE_W = (BASE_W * zoom) / 100;
  const GRID_STEP = gridStepFor(zoom);
  const setFields = (u: React.SetStateAction<EditorField[]>) => {
    setAllFields(u);
    setDirty(true);
  };
  const fields = pruneOrphanFields(allFields, signers.map((s) => s.id));
  const [tool, setTool] = useState<FieldKind | null>(null);
  const [picked, setAssignee] = useState(signers[0]?.id ?? "");
  // Signers can change after load (recipients saved above), so fall back to the first one.
  const assignee = signers.some((s) => s.id === picked) ? picked : (signers[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState<{ page: number; g: Guides }>({ page: 0, g: NO_GUIDES });
  const [ghost, setGhost] = useState<PaletteDrag | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const drag = useRef<FieldDrag | PaletteDrag | null>(null);
  // Set after a palette drag, so the click that follows the drop does not toggle the tool.
  const justDropped = useRef(false);
  const color = (rid: string) => COLORS[Math.max(0, signers.findIndex((s) => s.id === rid)) % COLORS.length];
  const sel = fields.find((f) => f.key === selected) ?? null;
  const update = (key: string, patch: Partial<EditorField>) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

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

  // Warn before leaving with unsaved field changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // App Router links skip beforeunload, so confirm in-app navigation too.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || e.defaultPrevented) return;
      if (!confirm("You have unsaved field changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  // Keyboard: nudge, duplicate, delete, deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") return setSelected(null), setTool(null);
      if (!sel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setFields((fs) => fs.filter((f) => f.key !== sel.key));
        return setSelected(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const copy = { ...sel, ...moveBox(sel, GRID_STEP, GRID_STEP), key: crypto.randomUUID() };
        setFields((fs) => [...fs, copy]);
        return setSelected(copy.key);
      }
      const step = e.altKey ? 0.001 : e.shiftKey ? GRID_STEP * 4 : GRID_STEP;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        const moved = moveBox(sel, d[0], d[1]);
        setFields((fs) => fs.map((f) => (f.key === sel.key ? { ...f, ...moved } : f)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, GRID_STEP]);

  function addField(type: FieldKind, page: number, cx: number, cy: number) {
    if (!assignee) return;
    const size = DEFAULT_FIELD_SIZE[type];
    let box = clampBox({ x: cx - size.w / 2, y: cy - size.h / 2, ...size });
    if (snap) box = moveBox(box, 0, 0, { grid: GRID_STEP });
    const f = { ...box, key: crypto.randomUUID(), recipientId: assignee, type, page };
    setFields((fs) => [...fs, f]);
    setSelected(f.key);
  }

  function place(e: React.MouseEvent<HTMLDivElement>, page: number) {
    if (e.target !== e.currentTarget.querySelector("canvas")) return;
    if (!tool) return setSelected(null);
    const r = e.currentTarget.getBoundingClientRect();
    addField(tool, page, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  function startFieldDrag(e: React.PointerEvent, f: EditorField, handle: Handle | "move") {
    e.stopPropagation();
    const pageEl = (e.currentTarget as HTMLElement).closest("[data-page]") as HTMLElement;
    const r = pageEl.getBoundingClientRect();
    drag.current = { kind: "field", key: f.key, handle, startX: e.clientX, startY: e.clientY, orig: { x: f.x, y: f.y, w: f.w, h: f.h }, pageW: r.width, pageH: r.height };
    setSelected(f.key);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startPaletteDrag(e: React.PointerEvent, type: FieldKind) {
    const d: PaletteDrag = { kind: "palette", type, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    drag.current = d;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "palette") {
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4;
      drag.current = { ...d, x: e.clientX, y: e.clientY, moved };
      if (moved) setGhost(drag.current as PaletteDrag);
      return;
    }
    const f = fields.find((x) => x.key === d.key);
    if (!f) return;
    const dx = (e.clientX - d.startX) / d.pageW;
    const dy = (e.clientY - d.startY) / d.pageH;
    const grid = snap && !e.altKey ? GRID_STEP : undefined;
    let box = d.handle === "move" ? moveBox(d.orig, dx, dy, { grid }) : resizeBox(d.orig, d.handle, dx, dy, { grid });
    let g = NO_GUIDES;
    if (d.handle === "move" && !e.altKey) {
      const others = fields.filter((x) => x.page === f.page && x.key !== f.key);
      const a = alignToOthers(box, others, ALIGN_PX / d.pageW);
      box = moveBox(a.box, 0, 0);
      g = a.guides;
    }
    setGuides({ page: f.page, g });
    update(d.key, box);
  }

  function onUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    setGuides({ page: 0, g: NO_GUIDES });
    if (!d || d.kind !== "palette") return;
    setGhost(null);
    if (!d.moved) return; // a plain click is handled by onClick (also covers keyboards)
    justDropped.current = true;
    const pageEl = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-page]") as HTMLElement | null;
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    addField(d.type, Number(pageEl.dataset.page), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  async function save() {
    setMsg({});
    const res = await props.save(fields.map(({ key: _key, ...f }) => f));
    if (res.error) return setMsg({ error: res.error });
    setMsg({ ok: `Saved ${res.count} fields` });
    setDirty(false);
  }

  if (signers.length === 0) {
    return <p className="border-brutal bg-yellow p-4 font-bold">{props.emptyText ?? "Add at least one signer above, then place their fields."}</p>;
  }

  const minorPx = PAGE_W * GRID_STEP;
  // Bold lines stay put on the page (every 10% of its width), so zooming in shows more fine lines between them.
  const majorStep = BASE_GRID_STEP * GRID_MAJOR_EVERY;
  return (
    <div className="grid grid-cols-[15rem_1fr] gap-6" onPointerMove={onMove} onPointerUp={onUp}>
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
              onPointerDown={(e) => startPaletteDrag(e, k.type)}
              onClick={() => {
                if (justDropped.current) return void (justDropped.current = false);
                setTool(tool === k.type ? null : k.type);
              }}
              className={`border-brutal flex touch-none select-none items-center justify-between px-3 py-2 text-left font-bold ${tool === k.type ? "bg-ink text-paper" : "bg-paper hover:bg-yellow"}`}
            >
              <span className="flex items-center gap-2">
                <k.Icon aria-hidden className="h-4 w-4" />
                {k.label}
              </span>
              <GripVertical aria-hidden className="h-4 w-4 opacity-50" />
            </button>
          ))}
        </div>
        {tool && (
          <Button type="button" size="sm" className="w-full justify-center" icon={<Crosshair aria-hidden className="h-4 w-4" />} onClick={() => addField(tool, sel?.page ?? 1, 0.5, 0.5)}>
            Place at center
          </Button>
        )}
        <ul aria-label="Signer colors" className="space-y-1 text-sm">
          {signers.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span aria-hidden className="border-brutal h-3 w-3" style={{ background: color(s.id) }} />
              {s.name}
            </li>
          ))}
        </ul>
        <p className="font-mono text-xs">Drag a field onto the page, or pick one and click. Arrows nudge, Shift+arrows move 4 cells, Alt for fine moves, Ctrl+D duplicates, Delete removes.</p>
        <div className="border-brutal space-y-1 p-2 font-mono text-xs font-bold uppercase">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Show grid
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid
          </label>
          <label className="flex items-center justify-between gap-2">
            Zoom
            <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="border-brutal bg-paper px-1 py-0.5">
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>
          </label>
        </div>
        {sel && (
          <div className="border-brutal space-y-2 bg-yellow/40 p-2" aria-label="Selected field">
            <p className="font-mono text-xs font-bold uppercase">
              {sel.type} - page {sel.page}
            </p>
            <select aria-label="Field signer" value={sel.recipientId} onChange={(e) => update(sel.key, { recipientId: e.target.value })} className="border-brutal w-full px-2 py-1">
              {signers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {sel.type !== "date" && (
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="checkbox" checked={sel.required ?? sel.type !== "checkbox"} onChange={(e) => update(sel.key, { required: e.target.checked })} /> Required
              </label>
            )}
            <Button type="button" className="w-full justify-center py-1" onClick={() => (setFields((fs) => fs.filter((f) => f.key !== sel.key)), setSelected(null))}>
              Delete field
            </Button>
          </div>
        )}
        <Button variant="primary" type="button" onClick={save} className="w-full justify-center">
          Save fields
        </Button>
        <p className={`font-mono text-xs font-bold ${dirty ? "text-red-ink" : ""}`}>{dirty ? "Unsaved changes" : "All changes saved"}</p>
        {msg.error && <p role="alert" className="border-brutal bg-red p-2 text-sm font-bold text-ink">{msg.error}</p>}
        {msg.ok && <p role="status" className="border-brutal bg-green p-2 text-sm font-bold">{msg.ok}</p>}
      </aside>

      <div className="min-w-0 space-y-6 overflow-x-auto">
        {!doc && <p className="font-mono">Loading PDF...</p>}
        {doc &&
          props.pageSizes.map((ps, i) => {
            const page = i + 1;
            const h = (ps.h / ps.w) * PAGE_W;
            const g = guides.page === page ? guides.g : NO_GUIDES;
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
                {showGrid && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: [
                        "linear-gradient(to right, rgba(0,0,0,.22) 1px, transparent 1px)",
                        "linear-gradient(to bottom, rgba(0,0,0,.22) 1px, transparent 1px)",
                        "linear-gradient(to right, rgba(0,0,0,.07) 1px, transparent 1px)",
                        "linear-gradient(to bottom, rgba(0,0,0,.07) 1px, transparent 1px)",
                      ].join(","),
                      backgroundSize: [
                        `${PAGE_W * majorStep}px ${h * majorStep}px`,
                        `${PAGE_W * majorStep}px ${h * majorStep}px`,
                        `${minorPx}px ${h * GRID_STEP}px`,
                        `${minorPx}px ${h * GRID_STEP}px`,
                      ].join(","),
                    }}
                  />
                )}
                {g.v.map((x) => (
                  <div key={`v${x}`} className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-red" style={{ left: x * PAGE_W }} />
                ))}
                {g.h.map((y) => (
                  <div key={`h${y}`} className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-red" style={{ top: y * h }} />
                ))}
                {fields
                  .filter((f) => f.page === page)
                  .map((f) => (
                    <div
                      key={f.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${f.type} field`}
                      onPointerDown={(e) => startFieldDrag(e, f, "move")}
                      onFocus={() => setSelected(f.key)}
                      className={`absolute flex cursor-move touch-none select-none items-center overflow-hidden border-2 border-ink px-1 font-mono text-[10px] font-bold uppercase ${selected === f.key ? "z-10 outline outline-2 outline-offset-2 outline-red" : ""}`}
                      style={{ left: f.x * PAGE_W, top: f.y * h, width: f.w * PAGE_W, height: f.h * h, background: color(f.recipientId) }}
                    >
                      {f.type}
                      {selected === f.key &&
                        HANDLES.map(({ h: hd, cls }) => (
                          <span
                            key={hd}
                            aria-hidden
                            onPointerDown={(e) => startFieldDrag(e, f, hd)}
                            className={`absolute h-3 w-3 border-2 border-ink bg-paper ${cls}`}
                          />
                        ))}
                    </div>
                  ))}
              </div>
            );
          })}
      </div>

      {ghost && (
        <div
          aria-hidden
          className="border-brutal pointer-events-none fixed z-50 bg-yellow px-2 py-1 font-mono text-xs font-bold uppercase shadow-hard-sm"
          style={{ left: ghost.x + 8, top: ghost.y + 8 }}
        >
          {ghost.type}
        </div>
      )}
    </div>
  );
}
