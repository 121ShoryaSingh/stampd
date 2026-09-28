import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getSessionOrNull() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const s = await getSessionOrNull();
  if (!s) redirect("/login");
  return s;
}
