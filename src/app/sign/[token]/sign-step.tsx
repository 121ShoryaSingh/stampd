"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfCanvas } from "@/components/pdf/pdf-canvas";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { submitAction, declineAction } from "./actions";
import { SignaturePad } from "./signature-pad";

type Field = { id: string; type: "signature" | "initials" | "date" | "text" | "checkbox"; page: number; x: number; y: number; w: number; h: number; required: boolean };
type View = { title: string; name: string; pdfUrl: string; pageSizes: { w: number; h: number }[]; fields: Field[] };

export function SignStep({ token, view }: { token: string; view: View }) {
  const router = useRouter();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(760);
  const [images, setImages] = useState<{ signature?: string; initials?: string }>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [pad, setPad] = useState<"signature" | "initials" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const fit = () => setWidth(Math.min(760, window.innerWidth - 40));
    fit();
    window.addEventListener("resize", fit);
    let alive = true;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const d = await pdfjs.getDocument({ url: view.pdfUrl }).promise;
      if (alive) setDoc(d);
    })().catch(() => setError("Could not load the document"));
    return () => {
      alive = false;
      window.removeEventListener("resize", fit);
    };
  }, [view.pdfUrl]);

  const filled = (f: Field) =>
    f.type === "date" ? true : f.type === "signature" ? !!images.signature : f.type === "initials" ? !!images.initials : f.type === "checkbox" ? values[f.id] === "true" || !f.required : !!values[f.id]?.trim();
  const required = view.fields.filter((f) => f.required || f.type === "signature" || f.type === "initials");
  const done = required.filter(filled).length;
  const complete = done === required.length;

  function next() {
    const f = required.find((x) => !filled(x));
    if (!f) return;
    refs.current[f.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    refs.current[f.id]?.focus();
  }

  async function finish() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    const res = await submitAction(token, { values, signaturePng: images.signature, initialsPng: images.initials });
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  async function decline(form: FormData) {
    const res = await declineAction(token, String(form.get("reason") ?? ""));
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-4 pb-28">
      <h1 className="font-display text-3xl">{view.title}</h1>
      {!doc && <p className="font-mono">Loading document...</p>}
      {doc &&
        view.pageSizes.map((ps, i) => {
          const page = i + 1;
          const h = (ps.h / ps.w) * width;
          return (
            <div key={page} className="border-brutal shadow-hard relative mx-auto bg-paper" style={{ width, height: h }}>
              <PdfCanvas doc={doc} pageNumber={page} width={width} />
              {view.fields
                .filter((f) => f.page === page)
                .map((f) => {
                  const style = { left: f.x * width, top: f.y * h, width: f.w * width, height: f.h * h };
                  const ok = filled(f);
                  const ring = `absolute border-2 border-ink ${ok ? "bg-green/30" : "bg-yellow/80 animate-pulse"}`;
                  if (f.type === "text") {
                    return (
                      <input
                        key={f.id}
                        ref={(el) => {
                          refs.current[f.id] = el;
                        }}
                        aria-label="text field"
                        placeholder="Enter text"
                        maxLength={500}
                        value={values[f.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                        className={`${ring} px-1 text-sm`}
                        style={style}
                      />
                    );
                  }
                  if (f.type === "date") {
                    return (
                      <div key={f.id} className="absolute flex items-center border-2 border-dashed border-ink/50 px-1 font-mono text-[10px]" style={style}>
                        Date (filled on finish)
                      </div>
                    );
                  }
                  const img = f.type === "signature" ? images.signature : f.type === "initials" ? images.initials : undefined;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      ref={(el) => {
                        refs.current[f.id] = el;
                      }}
                      aria-label={`${f.type} field`}
                      onClick={() => (f.type === "checkbox" ? setValues((v) => ({ ...v, [f.id]: v[f.id] === "true" ? "false" : "true" })) : setPad(f.type as "signature" | "initials"))}
                      className={`${ring} flex items-center justify-center font-mono text-[10px] font-bold uppercase`}
                      style={style}
                    >
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={`Your ${f.type}`} className="h-full w-full object-contain" />
                      ) : f.type === "checkbox" ? (
                        values[f.id] === "true" ? "X" : ""
                      ) : (
                        `Sign here`
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t-[2.5px] border-ink bg-paper p-3">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <div className="flex min-w-40 flex-1 items-center gap-2">
            <div className="border-brutal h-3 flex-1 bg-paper" aria-hidden>
              <div className="h-full bg-green transition-all" style={{ width: `${required.length ? (done / required.length) * 100 : 100}%` }} />
            </div>
            <span className="font-mono text-sm font-bold">
              {done} of {required.length} required
            </span>
          </div>
          <Button type="button" onClick={next} disabled={complete}>
            Next field
          </Button>
          <Button type="button" variant="primary" size="lg" onClick={() => setConfirming(true)} disabled={!complete || busy} loading={busy}>
            {busy ? "Finishing..." : "Finish"}
          </Button>
          <button type="button" className="ml-auto font-bold underline" onClick={() => setDeclining(true)}>
            Decline
          </button>
        </div>
        {error && <p role="alert" className="border-brutal mx-auto mt-2 max-w-4xl bg-red p-2 font-bold text-ink">{error}</p>}
      </div>

      {pad && (
        <SignaturePad
          kind={pad}
          defaultName={view.name}
          onCancel={() => setPad(null)}
          onAdopt={(png) => {
            setImages((m) => ({ ...m, [pad]: png }));
            setPad(null);
          }}
        />
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Finish signing">
        <p>
          You are signing <b>{view.title}</b> as <b>{view.name}</b>. Your signature, the date and your answers will be recorded with your IP address and device.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={() => setConfirming(false)}>
            Review again
          </Button>
          <Button type="button" variant="primary" onClick={finish}>
            Sign and finish
          </Button>
        </div>
      </Modal>

      <Modal open={declining} onClose={() => setDeclining(false)} title="Decline to sign">
        <form action={decline} className="space-y-3">
          <label className="block">
            <span className="mb-1 block font-mono text-xs font-bold uppercase">Reason</span>
            <textarea name="reason" required maxLength={500} rows={3} placeholder="Enter reason" className="border-brutal w-full p-2" />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button variant="primary">Decline</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
