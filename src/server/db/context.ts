import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./client";
import { ValidationError } from "@/server/errors";

export type Tx = Prisma.TransactionClient;
// worker: read-only discovery across tenants (email jobs, envelopes, recipients).
export type DbContext = { tenantId?: string; userId?: string; tokenHash?: string; worker?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runs fn in a transaction; Postgres RLS only shows rows this context allows.
export async function withDb<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (ctx.tenantId !== undefined && !UUID_RE.test(ctx.tenantId)) throw new ValidationError("Invalid workspace id");
  return prisma.$transaction(
    async (tx) => {
      // The one raw statement in the app: parameterized, transaction-local RLS context.
      await tx.$executeRaw`select set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.token_hash', ${ctx.tokenHash ?? ""}, true), set_config('app.worker', ${ctx.worker ? "on" : ""}, true)`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDb({ tenantId }, fn);
}
