import { cookies } from "next/headers";
import { openLink, getSigningView } from "@/server/signing/service";
import { isValidSession, sessionCookieName } from "@/server/signing/session";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { requestMeta } from "@/server/signing/meta";
import { CodeStep } from "./code-step";
import { ConsentStep } from "./consent-step";
import { SignStep } from "./sign-step";

function Notice({ title, children, tone = "bg-paper" }: { title: string; children: React.ReactNode; tone?: string }) {
  return (
    <Card className={`mx-auto max-w-lg ${tone}`}>
      <h1 className="font-display text-3xl">{title}</h1>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.length < 20 || token.length > 200) return <Notice title="This link is not valid">Check the link in your email.</Notice>;
  const link = await openLink(token, await requestMeta()).catch((e) => {
    if (e instanceof NotFoundError) return null;
    throw e;
  });
  if (!link) return <Notice title="This link is not valid">Check the link in your email, or ask the sender to resend it.</Notice>;

  if (link.state === "waiting") return <Notice title="Waiting for others">Someone signs before you. You can come back to this link once it is your turn.</Notice>;
  if (link.state === "signed") return <Notice title="All done" tone="bg-green">Thanks, {link.name}. Your signature was recorded. Everyone gets the final copy when all signers are done.</Notice>;
  if (link.state === "declined") return <Notice title="You declined this envelope">The sender has been told.</Notice>;
  if (link.state === "closed") return <Notice title="This envelope is closed">It was completed, voided, declined or expired. Contact the sender if you think this is a mistake.</Notice>;

  const session = (await cookies()).get(sessionCookieName(link.ref.recipientId))?.value;
  if (!isValidSession(session, link.ref.recipientId, link.otpVerifiedAt)) return <CodeStep token={token} email={link.email} />;
  if (!link.consented) return <ConsentStep token={token} title={link.title} message={link.senderMessage} />;
  const view = await getSigningView(token, session);
  return <SignStep token={token} view={view} />;
}
