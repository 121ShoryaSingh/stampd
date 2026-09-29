import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";

// Big Back / Next buttons at the bottom of a step; "next" is a link, a submit button, or a note on what is missing.
export function WizardNav({ back, next }: { back?: { href: string; label: string }; next?: ReactNode }) {
  return (
    <div className="border-brutal sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 bg-paper p-3 shadow-hard-sm">
      {back ? (
        <ButtonLink href={back.href} size="lg" icon={<ArrowLeft aria-hidden className="h-5 w-5" />}>
          {back.label}
        </ButtonLink>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
}

export function NextLink({ href, label }: { href: string; label: string }) {
  return (
    <ButtonLink href={href} variant="primary" size="lg">
      {label} <ArrowRight aria-hidden className="h-5 w-5" />
    </ButtonLink>
  );
}
