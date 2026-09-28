import Link from "next/link";
import { getSessionOrNull } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { AcceptButton } from "./accept-button";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSessionOrNull();
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <main className="grid min-h-screen place-items-center bg-pink p-6">
      <Card className="w-full max-w-md">
        <h1 className="font-display text-4xl">You are invited.</h1>
        {session ? (
          <>
            <p className="mt-3">
              Signed in as <b>{session.user.email}</b>.
            </p>
            <AcceptButton token={token} />
          </>
        ) : (
          <div className="mt-6 flex gap-3">
            <Link href={`/signup?next=${next}`} className="border-brutal shadow-hard-sm bg-red px-5 py-3 font-bold uppercase text-ink">
              Sign up
            </Link>
            <Link href={`/login?next=${next}`} className="border-brutal shadow-hard-sm px-5 py-3 font-bold uppercase">
              Log in
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
