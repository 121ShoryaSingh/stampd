import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

// Reuse one pool across dev hot reloads.
const g = globalThis as unknown as { stampdPg?: ReturnType<typeof postgres> };
export const pg = g.stampdPg ?? postgres(env.DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") g.stampdPg = pg;

export const db = drizzle(pg, { schema: { ...schema, ...authSchema } });
export type Db = typeof db;
