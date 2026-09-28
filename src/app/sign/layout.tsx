// Public signer area: no app sidebar and no sender session.
export default function SignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <header className="flex items-center justify-between border-b-[2.5px] border-ink bg-paper px-4 py-3">
        <span className="flex items-center gap-2 font-display text-xl">
          <i className="border-brutal inline-block h-5 w-5 rotate-6 bg-red" />
          Stampd
        </span>
        <span className="font-mono text-xs font-bold uppercase">Secured by Stampd</span>
      </header>
      <main className="mx-auto max-w-4xl p-4 md:p-8">{children}</main>
    </div>
  );
}
