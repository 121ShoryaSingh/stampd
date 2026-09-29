import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/server/env";
import { serialPool } from "./serial-pool";

// Reuse one client across dev hot reloads.
const g = globalThis as unknown as { stampdPrisma?: PrismaClient };
export const prisma = g.stampdPrisma ?? new PrismaClient({ adapter: new PrismaPg(serialPool({ connectionString: env.DATABASE_URL, max: 10 })) });
if (process.env.NODE_ENV !== "production") g.stampdPrisma = prisma;
