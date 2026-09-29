"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, CheckSquare, CircleDot, Crosshair, GripVertical, PenLine, Signature, TextCursorInput } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "@/lib/pdfjs";
import { PdfCanvas } from "@/components/pdf/pdf-canvas";
import { Button } from "@/components/ui/button";
import { useLeaveGuard } from "./leave-guard";
import { WizardNav } from "./wizard-nav";
import { clampBox, DEFAULT_FIELD_SIZE, type Box, type FieldKind } from "@/lib/fields/geometry";
import { CHOICE_MARKS, DEFAULT_OPTIONS, MARK_LABELS, MAX_LABEL, MAX_OPTION, MAX_OPTIONS, OPTION_SIZE, type ChoiceMark } from "@/lib/fields/choice";
import { pruneOrphanFields } from "@/lib/fields/prune";
import { alignToOthers, gridStepFor, moveBox, resizeBox, GRID_MAJOR_EVERY, GRID_STEP as BASE_GRID_STEP, type Guides, type Handle } from "@/lib/fields/snap";

type Recipient = { id: string; name: string; email: string; role: "signer" | "cc" };
type EditorField = Box & {
  key: string;
  recipientId: string;
  type: FieldKind;
  page: number;
  required?: boolean;
  label?: string | null;
  // Choice answer boxes: boxes of one question share groupKey.
  groupKey?: string | null;
  option?: string | null;
  mark?: ChoiceMark | null;
};
type PageSize = { w: number; h: number };
type FieldDrag = { kind: "field"; key: string; handle: Handle | "move"; startX: number; startY: number; orig: Box; pageW: number; pageH: number };
type PaletteDrag = { kind: "palette"; type: FieldKind; startX: number; startY: number; x: number; y: number; moved: boolean };

const KINDS: { type: FieldKind; label: string; Icon: typeof PenLine }[] = [
  { type: "signature", label: "Signature", Icon: Signature },
  { type: "initials", label: "Initials", Icon: PenLine },
  { type: "date", label: "Date", Icon: Calendar },
  { type: "text", label: "Text", Icon: TextCursorInput },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare },
  { type: "choice", label: "Choice (Yes / No)", Icon: CircleDot },
];
// Small boxes: corners just outside the box, leaving its inside free to grab and move.
const TINY_HANDLES: { h: Handle; cls: string }[] = [
  { h: "nw", cls: "-left-2 -top-2 cursor-nwse-resize" },
  { h: "ne", cls: "-right-2 -top-2 cursor-nesw-resize" },
  { h: "se", cls: "-bottom-2 -right-2 cursor-nwse-resize" },
  { h: "sw", cls: "-bottom-2 -left-2 cursor-nesw-resize" },
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
// Light enough for black text; distinct for up to eight people.
const COLORS = ["#FFE600", "#FF8AD8", "#00D26A", "#7FA8FF", "#FF9A6B", "#B99CFF", "#6FE3E3", "#C8F560"];
const BASE_W = 760;
const ZOOMS = [75, 100, 125, 150, 200, 300, 400];
const ALIGN_PX = 5;
// Up to this many people, "Assign to" is a list of color buttons; above it, a dropdown.
const PICKER_MAX = 6;
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
  // Wizard mode: big Back / "Save and continue" bar; continuing saves first.
  wizard?: { back: { href: string; label: string }; next: string };
}) {
  const router = useRouter();
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
  // Two people with the same name are told apart by their email.
  const sameName = (name: string) => signers.filter((s) => s.name === name).length > 1;
  const who = (s: Recipient) => (sameName(s.name) && s.email ? `${s.name} (${s.email})` : s.name);
  const sel = fields.find((f) => f.key === selected) ?? null;
  const update = (key: string, patch: Partial<EditorField>) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  // Question-wide settings (signer, required, question label, mark) apply to every answer box.
  const updateQuestion = (groupKey: string, patch: Partial<EditorField>) => setFields((fs) => fs.map((f) => (f.groupKey === groupKey ? { ...f, ...patch } : f)));
  const siblings = (f: EditorField | null) => (f?.groupKey ? fields.filter((x) => x.groupKey === f.groupKey) : []);
  // Questions are numbered in reading order of their first box, so tags stay stable while editing one.
  const questionNo = new Map<string, number>();
  for (const f of [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    if (f.groupKey && !questionNo.has(f.groupKey)) questionNo.set(f.groupKey, questionNo.size + 1);
  }

  // Removes one box; a question left with a single answer is removed whole.
  function removeField(f: EditorField) {
    const group = siblings(f);
    setFields((fs) => fs.filter((x) => (group.length > 0 && group.length <= 2 ? x.groupKey !== f.groupKey : x.key !== f.key)));
    setSelected(null);
  }

  // A copy of a question gets a new key and moves down one row, ready for the next line of a form.
  function duplicate(f: EditorField) {
    if (!f.groupKey) {
      const copy = { ...f, ...moveBox(f, GRID_STEP, GRID_STEP), key: crypto.randomUUID() };
      setFields((fs) => [...fs, copy]);
      return setSelected(copy.key);
    }
    const group = siblings(f);
    const dy = Math.max(...group.map((b) => b.h)) * 1.6;
    const groupKey = crypto.randomUUID();
    const copies = group.map((b) => ({ ...b, ...moveBox(b, 0, dy), key: crypto.randomUUID(), groupKey }));
    setFields((fs) => [...fs, ...copies]);
    setSelected(copies[group.indexOf(f)].key);
  }

  function addOption(f: EditorField) {
    const group = siblings(f).filter((b) => b.page === f.page);
    const right = group.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a), f);
    const taken = new Set(siblings(f).map((b) => (b.option ?? "").toLowerCase()));
    let n = siblings(f).length + 1;
    while (taken.has(`option ${n}`)) n++;
    const box = clampBox({ x: right.x + right.w + 0.02, y: right.y, w: right.w, h: right.h });
    const added = { ...f, ...box, key: crypto.randomUUID(), option: `Option ${n}` };
    setFields((fs) => [...fs, added]);
    setSelected(added.key);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const pdfjs = await loadPdfjs();
      const d = await pdfjs.getDocument({ url: props.pdfUrl }).promise;
      if (alive) setDoc(d);
    })().catch(() => setMsg({ error: "Could not load the PDF preview" }));
    return () => {
      alive = false;
    };
  }, [props.pdfUrl]);

  const leaveDialog = useLeaveGuard(dirty, "field changes");

  // Keyboard: nudge, duplicate, delete, deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") return setSelected(null), setTool(null);
      if (!sel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        return removeField(sel);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        return duplicate(sel);
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
  });

  function addField(type: FieldKind, page: number, cx: number, cy: number) {
    if (!assignee) return;
    if (type === "choice") return addQuestion(page, cx, cy);
    const size = DEFAULT_FIELD_SIZE[type];
    let box = clampBox({ x: cx - size.w / 2, y: cy - size.h / 2, ...size });
    if (snap) box = moveBox(box, 0, 0, { grid: GRID_STEP });
    const f = { ...box, key: crypto.randomUUID(), recipientId: assignee, type, page };
    setFields((fs) => [...fs, f]);
    setSelected(f.key);
  }

  // A new question: a Yes box and a No box side by side, to drag onto the document's own boxes or words.
  function addQuestion(page: number, cx: number, cy: number) {
    const groupKey = crypto.randomUUID();
    // Wide enough apart that the "Q1 Yes" / "Q1 No" tags above the boxes do not overlap.
    const gap = 0.07;
    const boxes = DEFAULT_OPTIONS.map((option, i) => {
      let box = clampBox({ x: cx - OPTION_SIZE.w - gap / 2 + i * (OPTION_SIZE.w + gap), y: cy - OPTION_SIZE.h / 2, ...OPTION_SIZE });
      if (snap) box = moveBox(box, 0, 0, { grid: GRID_STEP });
      return { ...box, key: crypto.randomUUID(), recipientId: assignee, type: "choice" as const, page, groupKey, option, mark: "check" as ChoiceMark, required: true };
    });
    setFields((fs) => [...fs, ...boxes]);
    setSelected(boxes[0].key);
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
    if (res.error) {
      setMsg({ error: res.error });
      return false;
    }
    setMsg({ ok: `Saved ${res.count} fields` });
    setDirty(false);
    return true;
  }

  const [continuing, setContinuing] = useState(false);
  // Wizard: save, then only move on once every signer can actually sign.
  async function saveAndContinue() {
    if (!props.wizard) return;
    const missing = signers.filter((s) => !fields.some((f) => f.recipientId === s.id && f.type === "signature"));
    if (missing.length > 0) return setMsg({ error: `Give ${missing.map((s) => s.name).join(", ")} a signature field before you continue` });
    setContinuing(true);
    // Nothing changed since the last save: just move on.
    const ok = dirty ? await save() : true;
    if (ok) router.push(props.wizard.next);
    else setContinuing(false);
  }

  if (signers.length === 0) {
    return <p className="border-brutal bg-yellow p-4 font-bold">{props.emptyText ?? "Add at least one signer above, then place their fields."}</p>;
  }

  const minorPx = PAGE_W * GRID_STEP;
  // Bold lines stay put on the page (every 10% of its width), so zooming in shows more fine lines between them.
  const majorStep = BASE_GRID_STEP * GRID_MAJOR_EVERY;
  const status = (
    <>
      {msg.error && <p role="alert" className="border-brutal bg-red p-2 text-sm font-bold text-ink">{msg.error}</p>}
      {msg.ok && <p role="status" className="border-brutal bg-green p-2 text-sm font-bold">{msg.ok}</p>}
    </>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[15rem_1fr] gap-6" onPointerMove={onMove} onPointerUp={onUp}>
        <aside className="sticky top-4 h-fit min-w-0 space-y-4">
          {signers.length <= PICKER_MAX ? (
            // A few people: pick by clicking their color, which doubles as the legend.
            <div>
              <p id="assign-to" className="mb-1 font-mono text-xs font-bold uppercase">
                Assign to
              </p>
              <div role="radiogroup" aria-labelledby="assign-to" className="grid min-w-0 grid-cols-1 gap-1">
                {signers.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={assignee === s.id}
                    aria-label={who(s)}
                    title={`${s.name} <${s.email}>`}
                    onClick={() => setAssignee(s.id)}
                    className={`border-brutal flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-sm font-bold ${assignee === s.id ? "shadow-hard-sm" : "bg-paper hover:bg-yellow/40"}`}
                    style={assignee === s.id ? { background: color(s.id) } : undefined}
                  >
                    <span aria-hidden className="border-brutal h-3 w-3 shrink-0" style={{ background: color(s.id) }} />
                    {/* Name on top, email below, each cut with "..." so long addresses never spill onto the page. */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.name}</span>
                      {s.email && <span className="block truncate font-mono text-[10px] font-normal">{s.email}</span>}
                    </span>
                    {assignee === s.id && <span className="shrink-0 font-mono text-[10px] uppercase">new</span>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block font-mono text-xs font-bold uppercase">Assign to</span>
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="border-brutal w-full px-2 py-2 font-bold" style={{ background: color(assignee) }}>
                  {signers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {who(s)}
                    </option>
                  ))}
                </select>
              </label>
              <ul aria-label="Signer colors" className="space-y-1 text-sm">
                {signers.map((s) => (
                  <li key={s.id} className="flex min-w-0 items-center gap-2" title={`${s.name} <${s.email}>`}>
                    <span aria-hidden className="border-brutal h-3 w-3 shrink-0" style={{ background: color(s.id) }} />
                    <span className="min-w-0 truncate">{who(s)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
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
          <p className="font-mono text-xs">Drag a field onto the page, or pick one and click. Arrows nudge, Shift+arrows move 4 cells, Alt for fine moves, Ctrl+D duplicates, Delete removes. A choice question has one box per answer: drag each onto the document&apos;s own box or word.</p>
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
                {sel.groupKey ? `Question ${questionNo.get(sel.groupKey)} (${siblings(sel).length} answers)` : sel.type} - page {sel.page}
              </p>
              <select
                aria-label="Field signer"
                value={sel.recipientId}
                onChange={(e) => (sel.groupKey ? updateQuestion(sel.groupKey, { recipientId: e.target.value }) : update(sel.key, { recipientId: e.target.value }))}
                className="border-brutal w-full px-2 py-1"
              >
                {signers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {who(s)}
                  </option>
                ))}
              </select>
              <label className="block">
                <span className="mb-0.5 block font-mono text-[10px] font-bold uppercase">{sel.groupKey ? "Question" : "Label"}</span>
                <input
                  aria-label={sel.groupKey ? "Question" : "Field label"}
                  value={sel.label ?? ""}
                  maxLength={MAX_LABEL}
                  placeholder={sel.groupKey ? "Enter question (optional)" : sel.type === "text" ? "Enter label, e.g. Company name" : "Enter label (optional)"}
                  onChange={(e) => (sel.groupKey ? updateQuestion(sel.groupKey, { label: e.target.value }) : update(sel.key, { label: e.target.value }))}
                  className="border-brutal w-full bg-paper px-2 py-1 text-sm"
                />
              </label>
              {sel.groupKey && (
                <>
                  <label className="block">
                    <span className="mb-0.5 block font-mono text-[10px] font-bold uppercase">This answer</span>
                    <input
                      aria-label="Answer label"
                      value={sel.option ?? ""}
                      maxLength={MAX_OPTION}
                      placeholder="Enter answer, e.g. Yes"
                      onChange={(e) => update(sel.key, { option: e.target.value })}
                      className="border-brutal w-full bg-paper px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block font-mono text-[10px] font-bold uppercase">Mark the chosen answer</span>
                    <select
                      aria-label="Mark the chosen answer"
                      value={sel.mark ?? "check"}
                      onChange={(e) => updateQuestion(sel.groupKey!, { mark: e.target.value as ChoiceMark })}
                      className="border-brutal w-full bg-paper px-2 py-1 text-sm"
                    >
                      {CHOICE_MARKS.map((m) => (
                        <option key={m} value={m}>
                          {MARK_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" className="flex-1 justify-center" disabled={siblings(sel).length >= MAX_OPTIONS} onClick={() => addOption(sel)}>
                      Add answer
                    </Button>
                    <Button type="button" size="sm" className="flex-1 justify-center" disabled={siblings(sel).length <= 2} onClick={() => removeField(sel)}>
                      Remove answer
                    </Button>
                  </div>
                </>
              )}
              {sel.type !== "date" && (
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={sel.required ?? sel.type !== "checkbox"}
                    onChange={(e) => (sel.groupKey ? updateQuestion(sel.groupKey, { required: e.target.checked }) : update(sel.key, { required: e.target.checked }))}
                  />{" "}
                  Required
                </label>
              )}
              <Button
                type="button"
                className="w-full justify-center py-1"
                onClick={() => (sel.groupKey ? (setFields((fs) => fs.filter((f) => f.groupKey !== sel.groupKey)), setSelected(null)) : removeField(sel))}
              >
                {sel.groupKey ? "Delete question" : "Delete field"}
              </Button>
            </div>
          )}
          <Button variant="primary" type="button" onClick={save} className="w-full justify-center">
            Save fields
          </Button>
          <p className={`font-mono text-xs font-bold ${dirty ? "text-red-ink" : ""}`}>{dirty ? "Unsaved changes" : "All changes saved"}</p>
          {/* In the wizard the message sits by "Save and continue", where the eye is. */}
          {!props.wizard && status}
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
                    .map((f) => {
                      // Tick-box sized fields: thin border and corner handles only, so they can sit on a printed box.
                      const tiny = f.w * PAGE_W < 28 || f.h * h < 28;
                      return (
                      <div
                        key={f.key}
                        role="button"
                        tabIndex={0}
                        aria-label={f.groupKey ? `question ${questionNo.get(f.groupKey)} answer ${f.option}` : `${f.type} field`}
                        title={f.groupKey ? `Question ${questionNo.get(f.groupKey)}${f.label ? `: ${f.label}` : ""} - ${f.option}` : (f.label ?? undefined)}
                        onPointerDown={(e) => startFieldDrag(e, f, "move")}
                        onFocus={() => setSelected(f.key)}
                        className={`absolute flex cursor-move touch-none select-none items-center border-ink font-mono ${tiny ? "border px-0" : "border-2 px-1"} text-[10px] font-bold uppercase ${selected === f.key ? "z-10 outline outline-2 outline-offset-2 outline-red" : sel?.groupKey && f.groupKey === sel.groupKey ? "z-10 outline-dashed outline-2 outline-offset-2 outline-red" : ""}`}
                        style={{ left: f.x * PAGE_W, top: f.y * h, width: f.w * PAGE_W, height: f.h * h, background: color(f.recipientId) }}
                      >
                        {f.groupKey && (
                          <span aria-hidden className="pointer-events-none absolute bottom-full left-0 mb-0.5 whitespace-nowrap bg-ink px-0.5 text-[9px] leading-tight text-paper">
                            Q{questionNo.get(f.groupKey)} {f.option}
                          </span>
                        )}
                        <span className="overflow-hidden whitespace-nowrap">{f.groupKey ? "" : f.label || f.type}</span>
                        {selected === f.key &&
                          (tiny ? TINY_HANDLES : HANDLES).map(({ h: hd, cls }) => (
                            <span
                              key={hd}
                              aria-hidden
                              onPointerDown={(e) => startFieldDrag(e, f, hd)}
                              className={`absolute border-ink bg-paper ${tiny ? "h-2 w-2 border" : "h-3 w-3 border-2"} ${cls}`}
                            />
                          ))}
                      </div>
                      );
                    })}
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
      {props.wizard && (
        <WizardNav
          back={props.wizard.back}
          next={
            <div className="flex flex-wrap items-center gap-3">
              {status}
              <Button variant="primary" size="lg" type="button" loading={continuing} onClick={saveAndContinue}>
                Save and continue
              </Button>
            </div>
          }
        />
      )}
      {leaveDialog}
    </div>
  );
}
