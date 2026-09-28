import type { Metadata } from "next";
import { getSessionOrNull } from "@/server/auth/session";
import { Landing } from "@/components/marketing/landing";

export const metadata: Metadata = {
  title: "Stampd - Get it signed. Not chased.",
  description: "E-signatures for teams that ship: signing order, reminders and a tamper-evident audit trail.",
};

export default async function HomePage() {
  const session = await getSessionOrNull();
  return <Landing signedIn={!!session} />;
}
