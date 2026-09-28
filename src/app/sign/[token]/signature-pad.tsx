"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const W = 600;
const H = 200;
type Mode = "draw" | "type" | "upload";

// Draw, type or upload a signature; always returns a 600x200 PNG data URL.
export function SignaturePad({ kind, defaultName, onAdopt, onCancel }: { kind: "signature" | "initials"; defaultName: string; onAdopt: (png: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>("draw");
  const [typed, setTyped] = useState(kind === "initials" ? initialsOf(defaultName) : defaultName);
  const [inked, setInked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctx = () => {
    const c = ref.current!.getContext("2d")!;
    c.lineWidth = 3.5;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#0b1f4d";
    c.fillStyle = "#0b1f4d";
    return c;
  };
  const clear = () => {
    ctx().clearRect(0, 0, W, H);
    setInked(false);
  };

  // Typed mode renders the name in a handwriting-style font.
  useEffect(() => {
    if (mode !== "type") return;
    const c = ctx();
    c.clearRect(0, 0, W, H);
    c.font = `italic ${kind === "initials" ? 96 : 64}px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(typed, W / 2, H / 2, W - 40);
    setInked(typed.trim().length > 0);
  }, [mode, typed, kind]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  function upload(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setError("Upload a PNG or JPG image");
    const img = new Image();
    img.onload = () => {
      const c = ctx();
      c.clearRect(0, 0, W, H);
      const s = Math.min(W / img.width, H / img.height, 1);
      c.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      setInked(true);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  return (
    <Modal open onClose={onCancel} title={`Adopt your ${kind}`}>
      <div>
        <div className="mb-3 flex gap-2">
          {(["draw", "type", "upload"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => (setMode(m), clear(), setError(null))}
              className={`border-brutal px-3 py-1 font-mono text-xs font-bold uppercase ${mode === m ? "bg-ink text-paper" : "bg-paper"}`}
            >
              {m}
            </button>
          ))}
        </div>
        {mode === "type" && (
          <input
            aria-label="Type your name"
            placeholder={`Enter your ${kind === "initials" ? "initials" : "name"}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="border-brutal mb-3 w-full px-3 py-2"
          />
        )}
        {mode === "upload" && <input aria-label="Upload signature image" type="file" accept="image/png,image/jpeg" onChange={(e) => upload(e.target.files?.[0])} className="mb-3 block" />}
        <canvas
          ref={ref}
          width={W}
          height={H}
          data-testid="signature-pad"
          className={`border-brutal block w-full touch-none ${mode === "draw" ? "cursor-crosshair" : ""}`}
          style={{ aspectRatio: `${W} / ${H}`, backgroundImage: "linear-gradient(to bottom, transparent 74%, #000 74%, #000 75%, transparent 75%)" }}
          onPointerDown={(e) => {
            if (mode !== "draw") return;
            last.current = pos(e);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (mode !== "draw" || !last.current) return;
            const p = pos(e);
            const c = ctx();
            c.beginPath();
            c.moveTo(last.current.x, last.current.y);
            c.quadraticCurveTo(last.current.x, last.current.y, (last.current.x + p.x) / 2, (last.current.y + p.y) / 2);
            c.lineTo(p.x, p.y);
            c.stroke();
            last.current = p;
            setInked(true);
          }}
          onPointerUp={() => (last.current = null)}
        />
        {error && <p role="alert" className="border-brutal mt-3 bg-red p-2 font-bold text-white">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={clear}>
            Clear
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!inked} onClick={() => onAdopt(ref.current!.toDataURL("image/png"))}>
            {kind === "initials" ? "Adopt initials" : "Adopt signature"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join("")
    .slice(0, 3);
}
