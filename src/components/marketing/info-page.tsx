import Link from "next/link";
import type { ReactNode } from "react";

// Plain content pages (security, terms, privacy) in the app's Neo-Brutalist style.
export function InfoPage({ title, intro, draft, updated, children }: { title: string; intro: ReactNode; draft?: boolean; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b-[2.5px] border-ink">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex items-center gap-2 font-display text-xl">
            <i aria-hidden className="border-brutal inline-block h-5 w-5 rotate-6 bg-red" /> Stampd
          </Link>
          <nav aria-label="Pages" className="flex flex-wrap gap-4 text-sm font-bold">
            <Link href="/security" className="underline-offset-4 hover:underline">Security</Link>
            <Link href="/terms" className="underline-offset-4 hover:underline">Terms</Link>
            <Link href="/privacy" className="underline-offset-4 hover:underline">Privacy</Link>
            <Link href="/login" className="underline-offset-4 hover:underline">Log in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">
        {draft && (
          <p role="note" className="border-brutal shadow-hard-sm mb-8 bg-yellow p-4 font-bold">
            Draft for review, not legal advice. Replace every [bracketed] part and have a lawyer review this page before launch.
          </p>
        )}
        <h1 className="font-display text-4xl md:text-6xl">{title}</h1>
        <div className="mt-4 max-w-2xl text-lg">{intro}</div>
        <p className="mt-2 font-mono text-xs">Last updated {updated}</p>
        <div className="mt-10 space-y-8">{children}</div>
      </main>
      <footer className="border-t-[2.5px] border-ink">
        <div className="mx-auto flex max-w-4xl flex-wrap justify-between gap-4 px-4 py-6 font-mono text-xs">
          <span>(c) 2026 Stampd. Working name.</span>
          <Link href="/" className="underline">Back to home</Link>
        </div>
      </footer>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-brutal bg-paper p-5">
      <h2 className="mb-3 font-display text-2xl">{title}</h2>
      <div className="space-y-3 leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">{children}</div>
    </section>
  );
}
