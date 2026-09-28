"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { TENANT_COOKIE } from "@/server/tenants/current";

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/login");
}
