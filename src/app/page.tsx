import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="font-display text-6xl">Stampd</h1>
      <p className="mt-4 text-lg">Get it signed. Not chased.</p>
      <div className="mt-8 flex gap-4">
        <Link href="/signup" className="border-brutal shadow-hard-sm bg-red px-5 py-3 font-bold uppercase text-white">Start free</Link>
        <Link href="/login" className="border-brutal shadow-hard-sm px-5 py-3 font-bold uppercase">Log in</Link>
      </div>
    </main>
  );
}
