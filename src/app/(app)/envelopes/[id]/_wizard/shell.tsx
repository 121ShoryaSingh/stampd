import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { STEPS, reachable, stepHref, type StepKey } from "./steps";

const NONE_DONE = Object.fromEntries(STEPS.map((s) => [s.key, false])) as Record<StepKey, boolean>;

// Page frame for every draft step: a big way back to the list, the title and the stepper.
// Without an id (the envelope does not exist yet) the steps are shown but not linked.
// `wide` lets a step (the field editor) use the whole width, e.g. with the app sidebar collapsed.
export function WizardShell({ id, title, current, done = NONE_DONE, wide = false, children }: { id?: string; title: string; current: StepKey; done?: Record<StepKey, boolean>; wide?: boolean; children: ReactNode }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <div className={`space-y-6 ${wide ? "" : "max-w-6xl"}`}>
      <ButtonLink href="/dashboard" size="lg" icon={<ArrowLeft aria-hidden className="h-5 w-5" />}>
        All envelopes
      </ButtonLink>
      <div>
        <p className="font-mono text-xs font-bold uppercase">{id ? "Draft envelope" : "Not saved yet"}</p>
        <h1 className="break-words font-display text-4xl md:text-5xl">{title}</h1>
      </div>
      <nav aria-label="Envelope steps">
        {/* Phones: where you are and how far along. */}
        <div className="md:hidden">
          <p className="font-bold">
            Step {at + 1} of {STEPS.length}: {STEPS[at].label}
          </p>
          <div className="border-brutal mt-2 h-3 bg-paper" aria-hidden>
            <div className="h-full bg-green" style={{ width: `${((at + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
        <ol className="hidden gap-2 md:grid md:grid-cols-5">
          {STEPS.map((s, i) => {
            const isCurrent = s.key === current;
            const isDone = done[s.key] && !isCurrent;
            const open = !!id && !isCurrent && reachable(s.key, done);
            const body = (
              <>
                <span aria-hidden className={`border-brutal grid h-8 w-8 shrink-0 place-items-center ${isDone ? "bg-green" : isCurrent ? "bg-ink text-paper" : "bg-paper"}`}>
                  {isDone ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.label}
                  {isDone && <span className="sr-only"> (done)</span>}
                </span>
              </>
            );
            const cls = "border-brutal flex h-full items-center gap-2 p-2 text-sm font-bold";
            return (
              <li key={s.key}>
                {open ? (
                  <Link href={stepHref(id, s.key)} className={`${cls} press bg-paper hover:bg-yellow`}>
                    {body}
                  </Link>
                ) : (
                  <span aria-current={isCurrent ? "step" : undefined} className={`${cls} ${isCurrent ? "bg-yellow shadow-hard-sm" : "bg-paper text-ink/70"}`}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
    </div>
  );
}
