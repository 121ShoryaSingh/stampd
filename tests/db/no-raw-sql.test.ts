import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// App code must use Prisma queries only; the single allowed raw statement is the RLS context line.
const ALLOWED = new Set(["src/server/db/context.ts"]);
const RAW = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b|\bsql`/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("no raw SQL in app code", () => {
  it("only context.ts uses a raw statement", () => {
    const offenders = files("src")
      .map((p) => relative(".", p).replace(/\\/g, "/"))
      .filter((p) => !ALLOWED.has(p) && RAW.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
