# Stampd Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Next.js app where a person can sign up, create a workspace (tenant), invite teammates, manage roles, and switch workspaces, with tenant isolation enforced by Postgres Row-Level Security.

**Architecture:** Next.js App Router (TypeScript) with all business logic in `src/server/`. Drizzle ORM over the `postgres` driver. Every tenant-scoped query runs inside `withTenant()`, which sets `app.tenant_id` for the transaction; RLS policies filter on it. Cross-tenant lookups (a user's workspaces, invitation tokens) go through two `SECURITY DEFINER` SQL functions. Better Auth handles email/password login.

**Tech Stack:** Next.js (latest), React 19, TypeScript strict, Tailwind CSS v4, Drizzle ORM + drizzle-kit, postgres (postgres.js), Better Auth 1.6, zod, uuidv7, Vitest + @testcontainers/postgresql, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-stampd-design.md` (sections 2, 3, 4 "Tenant isolation", 8, 9, 10). This is plan 1 of 5: Foundation, Envelopes, Signer flow, Worker, Marketing.

## Global Constraints

- IDs are UUIDv7 (`uuidv7` package) for app tables; Better Auth tables keep its text ids.
- Timestamps are `timestamptz` (`timestamp(..., { withTimezone: true })`).
- App connects as role `stampd_app` (not table owner). `stampd_migrator` owns the schema, runs migrations, has `BYPASSRLS`.
- Every tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy on `app.tenant_id`.
- All business logic in `src/server/`; files there start with `import "server-only";`.
- Membership roles are exactly `admin` and `member`.
- zod validation on every server action input.
- Plain ASCII in all files (no em/en dashes, no box-drawing characters).
- Comments: short and simple, one line, only where the code is not obvious. No long comment blocks.
- Line endings LF (`.gitattributes`), because Docker entrypoints break on CRLF.
- Design language: Neo-Brutalist: white, black 2.5px borders, hard shadows, 0px radius, accents yellow `#FFE600`, red `#FF3D00`, pink `#FF8AD8`, green `#00D26A`; fonts Archivo Black, Space Grotesk, JetBrains Mono.

## Review Focus

1. Email typed with different case or spaces (`" Bob@Acme.com"` vs `"bob@acme.com"`): must be treated as the same person for invites and duplicate-member checks. Pinned in Task 5 (`normalizeEmail` tests, duplicate-member test).
2. A tenant cookie that is stale or forged (points to a workspace the user is not in): must be ignored, falling back to the user's first workspace, never granting access. Pinned in Task 4 (`pickActiveTenant` tests).
3. Removing or demoting the last admin of a workspace: must be rejected so a workspace never ends up unmanageable. Pinned in Task 5.
4. Invitation misuse: accepting with a different logged-in email, after expiry, or a second time: all rejected. Pinned in Task 5.
5. Open redirect through `?next=` on login/signup (`//evil.com`, `https://evil.com`): must fall back to `/dashboard`. Pinned in Task 3 (`safeNext` tests).

---

## File Structure

```
.gitattributes, .env.example, compose.dev.yml, drizzle.config.ts, vitest.config.ts, playwright.config.ts
docker/postgres/init.sql                 dev roles + database
drizzle/                                 generated migrations (drizzle-kit)
scripts/migrate.ts                       CLI: run migrations + RLS as migrator
src/server/env.ts                        zod-validated env
src/server/errors.ts                     DomainError classes
src/server/db/schema.ts                  tenants, memberships, invitations
src/server/db/auth-schema.ts             Better Auth tables
src/server/db/client.ts                  postgres.js + drizzle instance
src/server/db/tenant.ts                  withTenant(), Tx type
src/server/db/migrate.ts                 runMigrations(url)
src/server/db/sql/rls.sql                grants, RLS policies, SECURITY DEFINER functions
src/server/auth/auth.ts                  Better Auth instance
src/server/auth/session.ts               requireSession()
src/server/auth/safe-next.ts             safeNext()
src/server/tenants/service.ts            createTenant, listUserTenants
src/server/tenants/current.ts            pickActiveTenant, requireTenant, TENANT_COOKIE
src/server/team/email.ts                 normalizeEmail
src/server/team/service.ts               invitations, members, roles
src/lib/auth-client.ts                   Better Auth React client
src/app/api/auth/[...all]/route.ts
src/app/(auth)/login/page.tsx, signup/page.tsx, auth-form.tsx
src/app/onboarding/page.tsx, actions.ts
src/app/(app)/layout.tsx, actions.ts, dashboard/page.tsx, settings/team/page.tsx, settings/team/actions.ts
src/app/invite/[token]/page.tsx, actions.ts
src/components/ui/button.tsx, input.tsx, card.tsx
src/components/app/sidebar.tsx, workspace-switcher.tsx
tests/global-setup.ts, tests/setup.ts, tests/helpers/db.ts, tests/stubs/server-only.ts
tests/db/rls.test.ts
src/server/**/*.test.ts                  unit/integration tests next to code
e2e/team.spec.ts
```

---

### Task 1: Scaffold Next.js, tooling and design tokens

**Files:**
- Create: whole Next.js scaffold, `.gitattributes`, `.env.example`, `compose.dev.yml`, `docker/postgres/init.sql`, `vitest.config.ts`, `tests/stubs/server-only.ts`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/card.tsx`, `src/components/ui/ui.test.tsx`
- Modify: `.gitignore`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `package.json`

**Interfaces:**
- Produces: `Button` (`variant?: "default" | "primary" | "accent"`, all `<button>` props), `Input` (all `<input>` props plus `label: string`), `Card` (`<div>` props). Tailwind theme colors `ink`, `paper`, `yellow`, `red`, `pink`, `green`; font utilities `font-display`, `font-sans`, `font-mono`; utility classes `shadow-hard`, `shadow-hard-sm`, `border-brutal`.

- [ ] **Step 1: Scaffold into a temp folder and move in** (create-next-app refuses a non-empty folder)

```bash
cd /c
npx create-next-app@latest stampd-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack --yes
cd /c/stampd-scaffold && rm -rf .git
cp -r /c/stampd-scaffold/. /c/stampd/ 2>/dev/null
rm -rf /c/stampd-scaffold
cd /c/stampd
```

Then re-merge `.gitignore` (the scaffold overwrote it) so it contains the Next.js defaults plus:

```
.superpowers/
.env*
!.env.example
/test-results/
/playwright-report/
```

- [ ] **Step 2: Line endings and env example**

`.gitattributes`:
```
* text=auto eol=lf
*.png binary
*.pdf binary
*.ico binary
```

Run: `git add --renormalize . && git status --short | head`

`.env.example`:
```
DATABASE_URL=postgres://stampd_app:app@localhost:5432/stampd
MIGRATOR_DATABASE_URL=postgres://stampd_migrator:migrator@localhost:5432/stampd
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
BETTER_AUTH_URL=http://localhost:3000
```

Run: `cp .env.example .env.local`

- [ ] **Step 3: Dev database**

`docker/postgres/init.sql`:
```sql
create role stampd_migrator login password 'migrator' bypassrls;
create role stampd_app login password 'app';
create database stampd owner stampd_migrator;
```

`compose.dev.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: postgres
    ports: ["127.0.0.1:5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/00-init.sql:ro
volumes:
  pgdata:
```

Run: `docker compose -f compose.dev.yml up -d && docker compose -f compose.dev.yml exec postgres psql -U postgres -c "\du"`
Expected: roles `stampd_app` and `stampd_migrator` listed, migrator has "Bypass RLS".

- [ ] **Step 4: Install dependencies**

```bash
npm i drizzle-orm postgres better-auth @better-auth/drizzle-adapter zod uuidv7 server-only
npm i -D drizzle-kit tsx vitest @vitejs/plugin-react @testing-library/react @testing-library/dom jsdom @testcontainers/postgresql @playwright/test
```

Add scripts to `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx --env-file=.env.local scripts/migrate.ts",
"e2e": "playwright test"
```

- [ ] **Step 5: Vitest config**

`tests/stubs/server-only.ts`:
```ts
export {};
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
```

Temporary `tests/global-setup.ts` (replaced in Task 2):
```ts
export default async function setup() {}
```

Temporary `tests/setup.ts` (replaced in Task 2):
```ts
export {};
```

- [ ] **Step 6: Design tokens**

Replace `src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --color-ink: #000000;
  --color-paper: #ffffff;
  --color-yellow: #ffe600;
  --color-red: #ff3d00;
  --color-pink: #ff8ad8;
  --color-green: #00d26a;
  --font-display: var(--font-archivo-black), sans-serif;
  --font-sans: var(--font-space-grotesk), sans-serif;
  --font-mono: var(--font-jetbrains-mono), monospace;
  --radius: 0px;
}

@utility border-brutal { border: 2.5px solid var(--color-ink); }
@utility shadow-hard { box-shadow: 6px 6px 0 var(--color-ink); }
@utility shadow-hard-sm { box-shadow: 4px 4px 0 var(--color-ink); }

body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); }
```

Replace `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Archivo_Black, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Archivo_Black({ weight: "400", subsets: ["latin"], variable: "--font-archivo-black" });
const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = { title: "Stampd", description: "E-signatures for teams that ship" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

Replace `src/app/page.tsx` (real landing arrives in Plan 5):
```tsx
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
```

- [ ] **Step 7: Write the failing UI test**

`src/components/ui/ui.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";
import { Input } from "./input";

describe("ui primitives", () => {
  it("Button renders primary variant with brutal border", () => {
    render(<Button variant="primary">Send</Button>);
    const b = screen.getByRole("button", { name: "Send" });
    expect(b.className).toContain("border-brutal");
    expect(b.className).toContain("bg-red");
  });

  it("Input links its label to the field", () => {
    render(<Input label="Work email" name="email" />);
    expect(screen.getByLabelText("Work email")).toHaveProperty("name", "email");
  });
});
```

Run: `npx vitest run src/components/ui`
Expected: FAIL, cannot resolve `./button`.

- [ ] **Step 8: Implement primitives**

`src/components/ui/button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from "react";

const variants = {
  default: "bg-paper text-ink",
  primary: "bg-red text-white",
  accent: "bg-yellow text-ink",
} as const;

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={`border-brutal shadow-hard-sm inline-flex items-center gap-2 px-5 py-3 text-sm font-bold uppercase tracking-wide transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
```

`src/components/ui/input.tsx`:
```tsx
import { useId, type InputHTMLAttributes } from "react";

export function Input({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">{label}</span>
      <input id={id} className={`border-brutal w-full bg-paper px-3 py-2.5 outline-none focus:bg-yellow ${className}`} {...props} />
    </label>
  );
}
```

`src/components/ui/card.tsx`:
```tsx
import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`border-brutal shadow-hard bg-paper p-6 ${className}`} {...props} />;
}
```

- [ ] **Step 9: Verify**

Run: `npx vitest run src/components/ui && npm run build`
Expected: 2 tests PASS; build succeeds.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with brutalist design tokens and test tooling"
```

---

### Task 2: Database schema, RLS and withTenant

**Files:**
- Create: `src/server/env.ts`, `src/server/errors.ts`, `src/server/db/schema.ts`, `src/server/db/auth-schema.ts`, `src/server/db/client.ts`, `src/server/db/tenant.ts`, `src/server/db/migrate.ts`, `src/server/db/sql/rls.sql`, `scripts/migrate.ts`, `drizzle.config.ts`, `tests/helpers/db.ts`, `tests/db/rls.test.ts`
- Replace: `tests/global-setup.ts`, `tests/setup.ts`
- Generated: `drizzle/*`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `db` (Drizzle instance), `type Db`
  - `withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>`, `type Tx`
  - tables `tenants`, `memberships`, `invitations`, `user`, `session`, `account`, `verification`; `type Role = "admin" | "member"`
  - `runMigrations(url: string): Promise<void>`
  - SQL functions `user_tenants(p_user_id text)` returning `(tenant_id uuid, name text, slug text, role text)` and `resolve_invitation(p_token_hash text)` returning `(tenant_id uuid, invitation_id uuid)`
  - errors `DomainError`, `NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`
  - test helpers `migratorSql()`, `insertUser(sql, email?)`

- [ ] **Step 1: Env and errors**

`src/server/env.ts`:
```ts
import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
});

export const env = schema.parse(process.env);
```

`src/server/errors.ts`:
```ts
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends DomainError {}
export class ForbiddenError extends DomainError {}
export class ValidationError extends DomainError {}
export class ConflictError extends DomainError {}
```

- [ ] **Step 2: Schema**

`src/server/db/auth-schema.ts` (Better Auth core tables, drizzle adapter default names):
```ts
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```
Note: after Task 3 installs the auth config, run `npx auth generate --adapter drizzle` (or `npx @better-auth/cli generate` on older CLIs) into a scratch file and diff it against this file; adjust columns if Better Auth 1.6 expects more.

`src/server/db/schema.ts`:
```ts
import { pgTable, uuid, text, timestamp, pgEnum, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { user } from "./auth-schema";

export const roleEnum = pgEnum("membership_role", ["admin", "member"]);
export type Role = (typeof roleEnum.enumValues)[number];

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").notNull().references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invitations_token_idx").on(t.tokenHash), index("invitations_tenant_email_idx").on(t.tenantId, t.email)],
);
```

`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/server/db/auth-schema.ts", "./src/server/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.MIGRATOR_DATABASE_URL ?? "" },
});
```

Run: `npm run db:generate`
Expected: `drizzle/0000_*.sql` created with 7 tables and the enum.

- [ ] **Step 3: RLS, grants and definer functions**

`src/server/db/sql/rls.sql` (idempotent; run after every migration):
```sql
grant usage on schema public to stampd_app;
grant select, insert, update, delete on all tables in schema public to stampd_app;
grant usage, select on all sequences in schema public to stampd_app;
alter default privileges in schema public grant select, insert, update, delete on tables to stampd_app;
alter default privileges in schema public grant usage, select on sequences to stampd_app;

create or replace function app_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

alter table tenants enable row level security;
alter table tenants force row level security;
drop policy if exists tenant_isolation on tenants;
create policy tenant_isolation on tenants
  using (id = app_tenant_id()) with check (id = app_tenant_id());

alter table memberships enable row level security;
alter table memberships force row level security;
drop policy if exists tenant_isolation on memberships;
create policy tenant_isolation on memberships
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

alter table invitations enable row level security;
alter table invitations force row level security;
drop policy if exists tenant_isolation on invitations;
create policy tenant_isolation on invitations
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

create or replace function user_tenants(p_user_id text)
returns table (tenant_id uuid, name text, slug text, role text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, m.role::text
  from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
  order by t.created_at
$$;
revoke all on function user_tenants(text) from public;
grant execute on function user_tenants(text) to stampd_app;

create or replace function resolve_invitation(p_token_hash text)
returns table (tenant_id uuid, invitation_id uuid)
language sql stable security definer set search_path = public as $$
  select i.tenant_id, i.id from invitations i
  where i.token_hash = p_token_hash and i.accepted_at is null and i.expires_at > now()
$$;
revoke all on function resolve_invitation(text) from public;
grant execute on function resolve_invitation(text) to stampd_app;
```
The definer functions are owned by `stampd_migrator` (`BYPASSRLS`), so they can read across tenants but only return the columns above.

`src/server/db/migrate.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(process.cwd(), "drizzle") });
    await sql.unsafe(readFileSync(join(process.cwd(), "src/server/db/sql/rls.sql"), "utf8"));
  } finally {
    await sql.end();
  }
}
```

`scripts/migrate.ts`:
```ts
import { runMigrations } from "../src/server/db/migrate";

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error("MIGRATOR_DATABASE_URL is not set");
await runMigrations(url);
console.log("migrations applied");
```

- [ ] **Step 4: Client and withTenant**

`src/server/db/client.ts`:
```ts
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

const g = globalThis as unknown as { stampdPg?: ReturnType<typeof postgres> };
export const pg = g.stampdPg ?? postgres(env.DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") g.stampdPg = pg;

export const db = drizzle(pg, { schema: { ...schema, ...authSchema } });
export type Db = typeof db;
```

`src/server/db/tenant.ts`:
```ts
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { ValidationError } from "@/server/errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new ValidationError("Invalid workspace id");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```

- [ ] **Step 5: Test harness**

Replace `tests/global-setup.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import postgres from "postgres";
import { runMigrations } from "../src/server/db/migrate";

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create role stampd_migrator login password 'migrator' bypassrls; create role stampd_app login password 'app';`);
  await admin.unsafe(`create database stampd_test owner stampd_migrator`);
  await admin.end();

  const base = `${container.getHost()}:${container.getPort()}/stampd_test`;
  const migratorUrl = `postgres://stampd_migrator:migrator@${base}`;
  await runMigrations(migratorUrl);

  project.provide("appDbUrl", `postgres://stampd_app:app@${base}`);
  project.provide("migratorDbUrl", migratorUrl);

  return async () => {
    await container?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    appDbUrl: string;
    migratorDbUrl: string;
  }
}
```

Replace `tests/setup.ts`:
```ts
import { inject } from "vitest";

process.env.DATABASE_URL = inject("appDbUrl");
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
```

`tests/helpers/db.ts`:
```ts
import { inject } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

/** Superuser-like connection (BYPASSRLS) for seeding and asserting. Close with `await sql.end()`. */
export function migratorSql() {
  return postgres(inject("migratorDbUrl"), { max: 2, onnotice: () => {} });
}

export async function insertUser(sql: ReturnType<typeof migratorSql>, email = `u-${randomUUID()}@test.dev`) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email) values (${id}, ${"Test " + id.slice(0, 4)}, ${email})`;
  return { id, email };
}

export async function insertTenant(sql: ReturnType<typeof migratorSql>, name = "Acme") {
  const [row] = await sql<{ id: string }[]>`
    insert into tenants (id, name, slug) values (gen_random_uuid(), ${name}, ${name.toLowerCase() + "-" + randomUUID().slice(0, 6)})
    returning id`;
  return row.id;
}
```

- [ ] **Step 6: Write the failing RLS tests**

`tests/db/rls.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql as dsql } from "drizzle-orm";
import { migratorSql, insertUser, insertTenant } from "../helpers/db";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { tenants, memberships, invitations } from "@/server/db/schema";

const admin = migratorSql();
let a: string, b: string, userA: { id: string }, userB: { id: string };

beforeAll(async () => {
  a = await insertTenant(admin, "Alpha");
  b = await insertTenant(admin, "Beta");
  userA = await insertUser(admin);
  userB = await insertUser(admin);
  await admin`insert into memberships (tenant_id, user_id, role) values (${a}, ${userA.id}, 'admin'), (${b}, ${userB.id}, 'admin')`;
  await admin`insert into invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
              values (gen_random_uuid(), ${b}, 'x@beta.dev', 'member', ${"h-" + b}, ${userB.id}, now() + interval '1 day')`;
});
afterAll(async () => { await admin.end(); });

describe("row-level security", () => {
  it("sees only its own tenant row", async () => {
    const rows = await withTenant(a, (tx) => tx.select().from(tenants));
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it("sees only its own memberships and invitations", async () => {
    const [m, i] = await withTenant(a, async (tx) => [await tx.select().from(memberships), await tx.select().from(invitations)]);
    expect(m.every((r) => r.tenantId === a)).toBe(true);
    expect(i).toHaveLength(0);
  });

  it("cannot insert a row for another tenant", async () => {
    await expect(
      withTenant(a, (tx) => tx.insert(memberships).values({ tenantId: b, userId: userA.id, role: "member" })),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update another tenant's rows", async () => {
    await withTenant(a, (tx) => tx.update(tenants).set({ name: "hacked" }).where(dsql`true`));
    const [row] = await admin`select name from tenants where id = ${b}`;
    expect(row.name).toBe("Beta");
  });

  it("returns nothing outside withTenant (no tenant set)", async () => {
    expect(await db.select().from(tenants)).toHaveLength(0);
  });

  it("user_tenants lists only that user's workspaces", async () => {
    const rows = await db.execute(dsql`select * from user_tenants(${userA.id})`);
    expect(rows.map((r) => r.tenant_id)).toEqual([a]);
  });

  it("resolve_invitation finds a valid token across tenants and nothing for a bad one", async () => {
    const ok = await db.execute(dsql`select * from resolve_invitation(${"h-" + b})`);
    const bad = await db.execute(dsql`select * from resolve_invitation(${"nope"})`);
    expect(ok[0]?.tenant_id).toBe(b);
    expect(bad).toHaveLength(0);
  });

  it("rejects a malformed tenant id", async () => {
    await expect(withTenant("' or 1=1 --", async () => 1)).rejects.toThrow(/Invalid workspace id/);
  });
});
```

- [ ] **Step 7: Run tests**

Docker Desktop must be running. Run: `npx vitest run tests/db`
Expected: all 8 PASS. If any fails, fix the SQL or code, never weaken the test.

- [ ] **Step 8: Apply to the dev database**

Run: `npm run db:migrate`
Expected: `migrations applied`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: postgres schema with row-level security and withTenant"
```

---

### Task 3: Authentication (Better Auth)

**Files:**
- Create: `src/server/auth/auth.ts`, `src/server/auth/session.ts`, `src/server/auth/safe-next.ts`, `src/server/auth/safe-next.test.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/(auth)/layout.tsx`, `src/app/(auth)/auth-form.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`

**Interfaces:**
- Consumes: `db`, `user`, `session`, `account`, `verification` (Task 2).
- Produces:
  - `auth` (Better Auth instance)
  - `requireSession(): Promise<{ user: { id: string; email: string; name: string }; session: { id: string } }>` (redirects to `/login` when signed out)
  - `getSessionOrNull()` same shape or `null`
  - `safeNext(next: string | null | undefined, fallback?: string): string`
  - `authClient` (React client)

- [ ] **Step 1: Write the failing safeNext test**

`src/server/auth/safe-next.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each([
    ["/settings/team", "/settings/team"],
    ["/invite/abc?x=1", "/invite/abc?x=1"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("safeNext(%s) -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
```

Run: `npx vitest run src/server/auth`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement safeNext**

`src/server/auth/safe-next.ts`:
```ts
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
```

Run: `npx vitest run src/server/auth`
Expected: PASS.

- [ ] **Step 3: Better Auth server**

`src/server/auth/auth.ts`:
```ts
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import * as authSchema from "@/server/db/auth-schema";
import { env } from "@/server/env";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [nextCookies()], // must stay last
});
```

`src/server/auth/session.ts`:
```ts
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
```

`src/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

`src/lib/auth-client.ts`:
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

- [ ] **Step 4: Auth pages**

`src/app/(auth)/layout.tsx`:
```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(#000_1.2px,transparent_1.2px)] [background-size:22px_22px] p-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
```

`src/app/(auth)/auth-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/server/auth/safe-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim().toLowerCase();
    const password = String(f.get("password"));
    const res =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: String(f.get("name")).trim() })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong");
    router.push(mode === "signup" && next === "/dashboard" ? "/onboarding" : next);
    router.refresh();
  }

  const other = mode === "login" ? "signup" : "login";
  const qs = params.get("next") ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <Card>
      <h1 className="font-display text-4xl">{mode === "login" ? "Welcome back." : "Start signing."}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {mode === "signup" && <Input label="Your name" name="name" required minLength={2} autoComplete="name" />}
        <Input label="Work email" name="email" type="email" required autoComplete="email" />
        <Input label="Password" name="password" type="password" required minLength={10}
          autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}
        <Button variant="primary" type="submit" disabled={pending} className="w-full justify-center">
          {pending ? "Working..." : mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        {mode === "login" ? "New here? " : "Have an account? "}
        <Link href={`/${other}${qs}`} className="font-bold underline">{other === "login" ? "Log in" : "Sign up"}</Link>
      </p>
    </Card>
  );
}
```
Note: `safeNext` is a pure function with no server imports, so it is safe to import from a client component; keep `safe-next.ts` free of `server-only`.

`src/app/(auth)/login/page.tsx`:
```tsx
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export default function LoginPage() {
  return <Suspense><AuthForm mode="login" /></Suspense>;
}
```

`src/app/(auth)/signup/page.tsx`:
```tsx
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export default function SignupPage() {
  return <Suspense><AuthForm mode="signup" /></Suspense>;
}
```

- [ ] **Step 5: Verify schema matches Better Auth**

Run: `npx auth generate --adapter drizzle --output /tmp/ba-schema.ts` (fallback: `npx @better-auth/cli@latest generate --output /tmp/ba-schema.ts`)
Compare with `src/server/db/auth-schema.ts`. If Better Auth expects extra columns, add them, then `npm run db:generate && npm run db:migrate`.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, open `http://localhost:3000/signup`, create an account.
Expected: redirect to `/onboarding` (404 until Task 4 is fine); a row exists: `docker compose -f compose.dev.yml exec postgres psql -U postgres -d stampd -c 'select email from "user"'`.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add -A
git commit -m "feat: email/password auth with Better Auth and safe redirects"
```

---

### Task 4: Workspaces (tenants), onboarding and app shell

**Files:**
- Create: `src/server/tenants/service.ts`, `src/server/tenants/service.test.ts`, `src/server/tenants/current.ts`, `src/server/tenants/pick.ts`, `src/server/tenants/pick.test.ts`, `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/actions.ts`, `src/app/(app)/dashboard/page.tsx`, `src/components/app/sidebar.tsx`, `src/components/app/workspace-switcher.tsx`

**Interfaces:**
- Consumes: `db`, `withTenant`, `tenants`, `memberships`, `ValidationError` (Task 2); `requireSession` (Task 3).
- Produces:
  - `type UserTenant = { tenantId: string; name: string; slug: string; role: Role }`
  - `createTenant(input: { userId: string; name: string }): Promise<{ id: string; slug: string }>`
  - `listUserTenants(userId: string): Promise<UserTenant[]>`
  - `pickActiveTenant(tenants: UserTenant[], cookieValue: string | undefined): UserTenant | null`
  - `TENANT_COOKIE = "stampd_tenant"`
  - `requireTenant(): Promise<{ session; tenant: UserTenant; tenants: UserTenant[] }>` (redirects to `/login` or `/onboarding`)
  - `slugify(name: string): string`

- [ ] **Step 1: Write the failing pure tests**

`src/server/tenants/pick.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pickActiveTenant, slugify } from "./pick";

const t = (id: string) => ({ tenantId: id, name: id, slug: id, role: "member" as const });

describe("pickActiveTenant", () => {
  it("uses the cookie when the user is a member", () => {
    expect(pickActiveTenant([t("a"), t("b")], "b")?.tenantId).toBe("b");
  });
  it("ignores a cookie for a workspace the user is not in", () => {
    expect(pickActiveTenant([t("a"), t("b")], "evil")?.tenantId).toBe("a");
  });
  it("falls back to the first workspace without a cookie", () => {
    expect(pickActiveTenant([t("a")], undefined)?.tenantId).toBe("a");
  });
  it("returns null when the user has no workspaces", () => {
    expect(pickActiveTenant([], "a")).toBeNull();
  });
});

describe("slugify", () => {
  it("lowercases, dashes, trims and strips symbols", () => {
    expect(slugify("  Acme & Sons, Ltd.  ")).toBe("acme-sons-ltd");
  });
  it("falls back for names with no usable characters", () => {
    expect(slugify("!!!")).toBe("workspace");
  });
});
```

Run: `npx vitest run src/server/tenants/pick.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement pick.ts**

`src/server/tenants/pick.ts`:
```ts
import type { Role } from "@/server/db/schema";

export type UserTenant = { tenantId: string; name: string; slug: string; role: Role };

export function pickActiveTenant(tenants: UserTenant[], cookieValue: string | undefined): UserTenant | null {
  return tenants.find((t) => t.tenantId === cookieValue) ?? tenants[0] ?? null;
}

export function slugify(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "workspace";
}
```

Run: `npx vitest run src/server/tenants/pick.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing service tests**

`src/server/tenants/service.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { createTenant, listUserTenants } from "./service";

const admin = migratorSql();
afterAll(async () => { await admin.end(); });

describe("tenant service", () => {
  it("creates a workspace with the creator as admin", async () => {
    const u = await insertUser(admin);
    const { id, slug } = await createTenant({ userId: u.id, name: "  Acme Inc " });
    expect(slug).toMatch(/^acme-inc-[0-9a-f]{6}$/);
    const list = await listUserTenants(u.id);
    expect(list).toEqual([{ tenantId: id, name: "Acme Inc", slug, role: "admin" }]);
  });

  it("lists several workspaces in creation order", async () => {
    const u = await insertUser(admin);
    const one = await createTenant({ userId: u.id, name: "One" });
    const two = await createTenant({ userId: u.id, name: "Two" });
    expect((await listUserTenants(u.id)).map((t) => t.tenantId)).toEqual([one.id, two.id]);
  });

  it("rejects names that are too short or too long", async () => {
    const u = await insertUser(admin);
    await expect(createTenant({ userId: u.id, name: " a " })).rejects.toThrow(/2 and 60/);
    await expect(createTenant({ userId: u.id, name: "x".repeat(61) })).rejects.toThrow(/2 and 60/);
  });
});
```

Run: `npx vitest run src/server/tenants/service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the service**

`src/server/tenants/service.ts`:
```ts
import "server-only";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { tenants, memberships, type Role } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { slugify, type UserTenant } from "./pick";

export type { UserTenant } from "./pick";

export async function createTenant(input: { userId: string; name: string }): Promise<{ id: string; slug: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new ValidationError("Workspace name must be between 2 and 60 characters");
  const id = uuidv7();
  const slug = `${slugify(name)}-${id.replace(/-/g, "").slice(-6)}`;
  await withTenant(id, async (tx) => {
    await tx.insert(tenants).values({ id, name, slug });
    await tx.insert(memberships).values({ tenantId: id, userId: input.userId, role: "admin" });
  });
  return { id, slug };
}

export async function listUserTenants(userId: string): Promise<UserTenant[]> {
  const rows = await db.execute<{ tenant_id: string; name: string; slug: string; role: Role }>(
    sql`select * from user_tenants(${userId})`,
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, name: r.name, slug: r.slug, role: r.role }));
}
```

Run: `npx vitest run src/server/tenants`
Expected: all PASS.

- [ ] **Step 5: Request helpers**

`src/server/tenants/current.ts`:
```ts
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { listUserTenants } from "./service";
import { pickActiveTenant } from "./pick";

export const TENANT_COOKIE = "stampd_tenant";

export async function requireTenant() {
  const session = await requireSession();
  const tenants = await listUserTenants(session.user.id);
  const tenant = pickActiveTenant(tenants, (await cookies()).get(TENANT_COOKIE)?.value);
  if (!tenant) redirect("/onboarding");
  return { session, tenant, tenants };
}

export async function setActiveTenantCookie(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
}
```

- [ ] **Step 6: Onboarding**

`src/app/onboarding/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { createTenant } from "@/server/tenants/service";
import { setActiveTenantCookie } from "@/server/tenants/current";
import { DomainError } from "@/server/errors";

const Input = z.object({ name: z.string().max(200) });

export async function createWorkspaceAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const parsed = Input.safeParse({ name: form.get("name") });
  if (!parsed.success) return { error: "Enter a workspace name" };
  let id: string;
  try {
    ({ id } = await createTenant({ userId: session.user.id, name: parsed.data.name }));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  await setActiveTenantCookie(id);
  redirect("/dashboard");
}
```

`src/app/onboarding/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { createWorkspaceAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function OnboardingPage() {
  const [state, action, pending] = useActionState(createWorkspaceAction, {});
  return (
    <main className="grid min-h-screen place-items-center bg-yellow p-6">
      <Card className="w-full max-w-md">
        <p className="font-mono text-xs font-bold uppercase">Step 1 of 1</p>
        <h1 className="mt-2 font-display text-4xl">Name your workspace.</h1>
        <p className="mt-2">Usually your company or team name. You can invite teammates next.</p>
        <form action={action} className="mt-6 space-y-4">
          <Input label="Workspace name" name="name" required minLength={2} maxLength={60} placeholder="Acme Inc" />
          {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{state.error}</p>}
          <Button variant="primary" disabled={pending} className="w-full justify-center">{pending ? "Creating..." : "Create workspace"}</Button>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 7: App shell with workspace switcher**

`src/app/(app)/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { listUserTenants } from "@/server/tenants/service";
import { setActiveTenantCookie } from "@/server/tenants/current";

export async function switchWorkspaceAction(form: FormData) {
  const session = await requireSession();
  const tenantId = z.string().uuid().parse(form.get("tenantId"));
  const mine = await listUserTenants(session.user.id);
  if (!mine.some((t) => t.tenantId === tenantId)) return; // not a member: ignore
  await setActiveTenantCookie(tenantId);
  revalidatePath("/", "layout");
}
```

`src/components/app/workspace-switcher.tsx`:
```tsx
"use client";

import { switchWorkspaceAction } from "@/app/(app)/actions";
import type { UserTenant } from "@/server/tenants/pick";

export function WorkspaceSwitcher({ tenants, activeId }: { tenants: UserTenant[]; activeId: string }) {
  return (
    <form action={switchWorkspaceAction}>
      <label className="block font-mono text-[10px] font-bold uppercase">Workspace</label>
      <select
        name="tenantId"
        defaultValue={activeId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="border-brutal mt-1 w-full bg-yellow px-2 py-2 font-bold"
      >
        {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
      </select>
    </form>
  );
}
```

`src/components/app/sidebar.tsx`:
```tsx
import Link from "next/link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { UserTenant } from "@/server/tenants/pick";

const nav = [
  { href: "/dashboard", label: "Envelopes" },
  { href: "/settings/team", label: "Team" },
];

export function Sidebar({ tenants, active, userEmail }: { tenants: UserTenant[]; active: UserTenant; userEmail: string }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-6 border-r-[2.5px] border-ink bg-paper p-5">
      <Link href="/dashboard" className="flex items-center gap-2 font-display text-2xl">
        <i className="border-brutal inline-block h-6 w-6 rotate-6 bg-red" />Stampd
      </Link>
      <WorkspaceSwitcher tenants={tenants} activeId={active.tenantId} />
      <nav className="flex flex-col gap-1">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="px-2 py-2 font-bold hover:bg-yellow">{n.label}</Link>
        ))}
      </nav>
      <div className="mt-auto font-mono text-xs">
        <p className="truncate">{userEmail}</p>
        <p className="uppercase">{active.role}</p>
      </div>
    </aside>
  );
}
```

`src/app/(app)/layout.tsx`:
```tsx
import { requireTenant } from "@/server/tenants/current";
import { Sidebar } from "@/components/app/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant, tenants } = await requireTenant();
  return (
    <div className="flex min-h-screen">
      <Sidebar tenants={tenants} active={tenant} userEmail={session.user.email} />
      <main className="flex-1 bg-[#FAFAFA] p-8">{children}</main>
    </div>
  );
}
```

`src/app/(app)/dashboard/page.tsx`:
```tsx
import { requireTenant } from "@/server/tenants/current";
import { Card } from "@/components/ui/card";

export default async function DashboardPage() {
  const { tenant } = await requireTenant();
  return (
    <div>
      <h1 className="font-display text-5xl">Envelopes</h1>
      <p className="mt-2 font-mono text-sm">{tenant.name}</p>
      <Card className="mt-8 bg-yellow">
        <h2 className="font-display text-2xl">Nothing sent yet.</h2>
        <p className="mt-2">Upload a PDF to send your first envelope. (Arrives in Plan 2.)</p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.
Manual: `npm run dev`, sign up, create a workspace, land on dashboard; create a second workspace via `/onboarding` and switch between them in the sidebar.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: workspaces with onboarding, active-workspace cookie and app shell"
```

---

### Task 5: Team management (invitations, roles, removal)

**Files:**
- Create: `src/server/team/email.ts`, `src/server/team/email.test.ts`, `src/server/team/service.ts`, `src/server/team/service.test.ts`, `src/app/(app)/settings/team/page.tsx`, `src/app/(app)/settings/team/actions.ts`, `src/app/(app)/settings/team/invite-form.tsx`, `src/app/invite/[token]/page.tsx`, `src/app/invite/[token]/actions.ts`, `src/app/invite/[token]/accept-button.tsx`

**Interfaces:**
- Consumes: `db`, `withTenant`, `memberships`, `invitations`, `user`, errors (Task 2); `requireSession`, `getSessionOrNull` (Task 3); `requireTenant`, `setActiveTenantCookie` (Task 4).
- Produces:
  - `normalizeEmail(raw: string): string` (throws `ValidationError` on invalid)
  - `hashToken(token: string): string` (sha256 hex)
  - `createInvitation(i: { tenantId; actorUserId; email; role: Role }): Promise<{ invitationId: string; token: string }>`
  - `acceptInvitation(i: { token; userId; userEmail }): Promise<{ tenantId: string }>`
  - `listMembers(tenantId): Promise<{ userId; name; email; role: Role }[]>`
  - `listPendingInvitations(tenantId): Promise<{ id; email; role: Role; expiresAt: Date }[]>`
  - `revokeInvitation(i: { tenantId; actorUserId; invitationId }): Promise<void>`
  - `changeRole(i: { tenantId; actorUserId; targetUserId; role: Role }): Promise<void>`
  - `removeMember(i: { tenantId; actorUserId; targetUserId }): Promise<void>`
  - `INVITE_TTL_DAYS = 7`

- [ ] **Step 1: Write the failing email test**

`src/server/team/email.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Bob@Acme.COM ")).toBe("bob@acme.com");
  });
  it("rejects invalid addresses", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow(/valid email/);
    expect(() => normalizeEmail("")).toThrow(/valid email/);
  });
});
```

Run: `npx vitest run src/server/team/email.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement email.ts**

`src/server/team/email.ts`:
```ts
import { z } from "zod";
import { ValidationError } from "@/server/errors";

const Email = z.string().email().max(254);

export function normalizeEmail(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!Email.safeParse(v).success) throw new ValidationError("Enter a valid email address");
  return v;
}
```

Run: `npx vitest run src/server/team/email.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing service tests**

`src/server/team/service.test.ts`:
```ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { createTenant } from "@/server/tenants/service";
import {
  createInvitation, acceptInvitation, listMembers, listPendingInvitations,
  changeRole, removeMember, revokeInvitation, hashToken,
} from "./service";

const admin = migratorSql();
afterAll(async () => { await admin.end(); });

let owner: { id: string; email: string }, tenantId: string;
beforeEach(async () => {
  owner = await insertUser(admin);
  ({ id: tenantId } = await createTenant({ userId: owner.id, name: "Team Co" }));
});

async function addMember(role: "admin" | "member" = "member") {
  const u = await insertUser(admin);
  const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: u.email, role });
  await acceptInvitation({ token, userId: u.id, userEmail: u.email });
  return u;
}

describe("invitations", () => {
  it("invite + accept makes the user a member with the invited role", async () => {
    const u = await addMember("member");
    const members = await listMembers(tenantId);
    expect(members.find((m) => m.userId === u.id)?.role).toBe("member");
  });

  it("stores only a hash of the token", async () => {
    const { token, invitationId } = await createInvitation({ tenantId, actorUserId: owner.id, email: "hash@x.dev", role: "member" });
    const [row] = await admin`select token_hash from invitations where id = ${invitationId}`;
    expect(row.token_hash).toBe(hashToken(token));
    expect(row.token_hash).not.toContain(token);
  });

  it("matches emails case-insensitively on accept", async () => {
    const u = await insertUser(admin, `mixed-${Date.now()}@x.dev`);
    const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: `  ${u.email.toUpperCase()} `, role: "member" });
    await expect(acceptInvitation({ token, userId: u.id, userEmail: u.email })).resolves.toEqual({ tenantId });
  });

  it("rejects accepting with a different account email", async () => {
    const other = await insertUser(admin);
    const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: "someone@else.dev", role: "member" });
    await expect(acceptInvitation({ token, userId: other.id, userEmail: other.email })).rejects.toThrow(/different email/);
  });

  it("rejects reuse and expiry", async () => {
    const u = await insertUser(admin);
    const { token, invitationId } = await createInvitation({ tenantId, actorUserId: owner.id, email: u.email, role: "member" });
    await acceptInvitation({ token, userId: u.id, userEmail: u.email });
    await expect(acceptInvitation({ token, userId: u.id, userEmail: u.email })).rejects.toThrow(/invalid or has expired/);

    const v = await insertUser(admin);
    const second = await createInvitation({ tenantId, actorUserId: owner.id, email: v.email, role: "member" });
    await admin`update invitations set expires_at = now() - interval '1 minute' where id = ${second.invitationId}`;
    await expect(acceptInvitation({ token: second.token, userId: v.id, userEmail: v.email })).rejects.toThrow(/invalid or has expired/);
    expect(invitationId).toBeTruthy();
  });

  it("rejects inviting an existing member (case-insensitive)", async () => {
    const u = await addMember();
    await expect(
      createInvitation({ tenantId, actorUserId: owner.id, email: u.email.toUpperCase(), role: "member" }),
    ).rejects.toThrow(/already a member/);
  });

  it("re-inviting replaces the pending invitation", async () => {
    await createInvitation({ tenantId, actorUserId: owner.id, email: "re@x.dev", role: "member" });
    await createInvitation({ tenantId, actorUserId: owner.id, email: "re@x.dev", role: "admin" });
    const pending = (await listPendingInvitations(tenantId)).filter((i) => i.email === "re@x.dev");
    expect(pending).toHaveLength(1);
    expect(pending[0].role).toBe("admin");
  });

  it("members cannot invite or revoke", async () => {
    const m = await addMember("member");
    await expect(createInvitation({ tenantId, actorUserId: m.id, email: "n@x.dev", role: "member" })).rejects.toThrow(/admins/);
    const { invitationId } = await createInvitation({ tenantId, actorUserId: owner.id, email: "r@x.dev", role: "member" });
    await expect(revokeInvitation({ tenantId, actorUserId: m.id, invitationId })).rejects.toThrow(/admins/);
  });
});

describe("roles and removal", () => {
  it("admin can promote and demote", async () => {
    const m = await addMember();
    await changeRole({ tenantId, actorUserId: owner.id, targetUserId: m.id, role: "admin" });
    await changeRole({ tenantId, actorUserId: owner.id, targetUserId: m.id, role: "member" });
    expect((await listMembers(tenantId)).find((x) => x.userId === m.id)?.role).toBe("member");
  });

  it("cannot demote or remove the last admin", async () => {
    await expect(changeRole({ tenantId, actorUserId: owner.id, targetUserId: owner.id, role: "member" })).rejects.toThrow(/last admin/);
    await expect(removeMember({ tenantId, actorUserId: owner.id, targetUserId: owner.id })).rejects.toThrow(/last admin/);
  });

  it("a member can leave, but cannot remove others", async () => {
    const m1 = await addMember();
    const m2 = await addMember();
    await expect(removeMember({ tenantId, actorUserId: m1.id, targetUserId: m2.id })).rejects.toThrow(/admins/);
    await removeMember({ tenantId, actorUserId: m1.id, targetUserId: m1.id });
    expect((await listMembers(tenantId)).some((x) => x.userId === m1.id)).toBe(false);
  });
});
```

Run: `npx vitest run src/server/team/service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the team service**

`src/server/team/service.ts`:
```ts
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withTenant, type Tx } from "@/server/db/tenant";
import { invitations, memberships, type Role } from "@/server/db/schema";
import { user } from "@/server/db/auth-schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { normalizeEmail } from "./email";

export const INVITE_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function roleOf(tx: Tx, userId: string): Promise<Role | null> {
  const [m] = await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
  return m?.role ?? null;
}

async function assertAdmin(tx: Tx, userId: string) {
  if ((await roleOf(tx, userId)) !== "admin") throw new ForbiddenError("Only admins can do that");
}

async function assertNotLastAdmin(tx: Tx, targetUserId: string) {
  const admins = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.role, "admin"))
    .for("update");
  if (admins.length === 1 && admins[0].userId === targetUserId) {
    throw new ConflictError("A workspace needs at least one admin. Promote someone else first (last admin).");
  }
}

export async function createInvitation(i: { tenantId: string; actorUserId: string; email: string; role: Role }) {
  const email = normalizeEmail(i.email);
  const token = randomBytes(32).toString("base64url");
  return withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.actorUserId);
    const [existing] = await tx
      .select({ id: memberships.userId })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(sql`lower(${user.email}) = ${email}`);
    if (existing) throw new ConflictError(`${email} is already a member`);
    await tx.delete(invitations).where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)));
    const [row] = await tx
      .insert(invitations)
      .values({
        tenantId: i.tenantId,
        email,
        role: i.role,
        tokenHash: hashToken(token),
        invitedBy: i.actorUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      })
      .returning({ id: invitations.id });
    return { invitationId: row.id, token };
  });
}

export async function acceptInvitation(i: { token: string; userId: string; userEmail: string }): Promise<{ tenantId: string }> {
  const rows = await db.execute<{ tenant_id: string; invitation_id: string }>(
    sql`select * from resolve_invitation(${hashToken(i.token)})`,
  );
  const found = rows[0];
  if (!found) throw new NotFoundError("This invitation is invalid or has expired");
  return withTenant(found.tenant_id, async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, found.invitation_id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .for("update");
    if (!inv) throw new NotFoundError("This invitation is invalid or has expired");
    if (inv.email !== normalizeEmail(i.userEmail)) {
      throw new ForbiddenError(`This invitation was sent to a different email (${inv.email})`);
    }
    await tx
      .insert(memberships)
      .values({ tenantId: found.tenant_id, userId: i.userId, role: inv.role })
      .onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    return { tenantId: found.tenant_id };
  });
}

export async function listMembers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ userId: memberships.userId, name: user.name, email: user.email, role: memberships.role })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .orderBy(memberships.createdAt),
  );
}

export async function listPendingInvitations(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(invitations.createdAt),
  );
}

export async function revokeInvitation(i: { tenantId: string; actorUserId: string; invitationId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.actorUserId);
    await tx.delete(invitations).where(and(eq(invitations.id, i.invitationId), isNull(invitations.acceptedAt)));
  });
}

export async function changeRole(i: { tenantId: string; actorUserId: string; targetUserId: string; role: Role }) {
  await withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.actorUserId);
    if (i.role === "member") await assertNotLastAdmin(tx, i.targetUserId);
    const res = await tx
      .update(memberships)
      .set({ role: i.role })
      .where(eq(memberships.userId, i.targetUserId))
      .returning({ userId: memberships.userId });
    if (res.length === 0) throw new NotFoundError("Member not found");
  });
}

export async function removeMember(i: { tenantId: string; actorUserId: string; targetUserId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    if (i.actorUserId !== i.targetUserId) await assertAdmin(tx, i.actorUserId);
    await assertNotLastAdmin(tx, i.targetUserId);
    const res = await tx
      .delete(memberships)
      .where(eq(memberships.userId, i.targetUserId))
      .returning({ userId: memberships.userId });
    if (res.length === 0) throw new NotFoundError("Member not found");
  });
}
```

Run: `npx vitest run src/server/team`
Expected: all PASS.

- [ ] **Step 5: Team settings page and actions**

`src/app/(app)/settings/team/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { createInvitation, changeRole, removeMember, revokeInvitation } from "@/server/team/service";
import { DomainError } from "@/server/errors";
import { env } from "@/server/env";

type State = { error?: string; inviteUrl?: string };
const RoleSchema = z.enum(["admin", "member"]);

export async function inviteAction(_prev: State, form: FormData): Promise<State> {
  const { session, tenant } = await requireTenant();
  const parsed = z.object({ email: z.string().max(254), role: RoleSchema }).safeParse({
    email: form.get("email"), role: form.get("role"),
  });
  if (!parsed.success) return { error: "Enter an email and a role" };
  try {
    const { token } = await createInvitation({ tenantId: tenant.tenantId, actorUserId: session.user.id, ...parsed.data });
    revalidatePath("/settings/team");
    return { inviteUrl: `${env.BETTER_AUTH_URL}/invite/${token}` }; // emailed in Plan 4
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) redirect(`/settings/team?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/settings/team");
}

export async function changeRoleAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const targetUserId = z.string().min(1).parse(form.get("userId"));
  const role = RoleSchema.parse(form.get("role"));
  await run(() => changeRole({ tenantId: tenant.tenantId, actorUserId: session.user.id, targetUserId, role }));
}

export async function removeMemberAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const targetUserId = z.string().min(1).parse(form.get("userId"));
  await run(() => removeMember({ tenantId: tenant.tenantId, actorUserId: session.user.id, targetUserId }));
  if (targetUserId === session.user.id) redirect("/dashboard");
}

export async function revokeInviteAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const invitationId = z.string().uuid().parse(form.get("invitationId"));
  await run(() => revokeInvitation({ tenantId: tenant.tenantId, actorUserId: session.user.id, invitationId }));
}
```

`src/app/(app)/settings/team/invite-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { inviteAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1"><Input label="Email" name="email" type="email" required /></div>
      <label className="block">
        <span className="mb-1 block font-mono text-xs font-bold uppercase">Role</span>
        <select name="role" defaultValue="member" className="border-brutal bg-paper px-3 py-2.5 font-bold">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <Button variant="primary" disabled={pending}>{pending ? "Inviting..." : "Invite"}</Button>
      {state.error && <p role="alert" className="border-brutal w-full bg-red p-3 font-bold text-white">{state.error}</p>}
      {state.inviteUrl && (
        <div className="border-brutal w-full bg-green p-3">
          <p className="font-bold">Invite created. Send this link (email delivery arrives in Plan 4):</p>
          <input readOnly value={state.inviteUrl} onFocus={(e) => e.currentTarget.select()} className="border-brutal mt-2 w-full bg-paper px-2 py-1 font-mono text-xs" data-testid="invite-url" />
        </div>
      )}
    </form>
  );
}
```

`src/app/(app)/settings/team/page.tsx`:
```tsx
import { requireTenant } from "@/server/tenants/current";
import { listMembers, listPendingInvitations } from "@/server/team/service";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InviteForm } from "./invite-form";
import { changeRoleAction, removeMemberAction, revokeInviteAction } from "./actions";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, tenant } = await requireTenant();
  const [members, invites, { error }] = await Promise.all([
    listMembers(tenant.tenantId), listPendingInvitations(tenant.tenantId), searchParams,
  ]);
  const isAdmin = tenant.role === "admin";
  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="font-display text-5xl">Team</h1>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}
      {isAdmin && <Card><h2 className="mb-4 font-display text-2xl">Invite a teammate</h2><InviteForm /></Card>}
      <Card className="p-0">
        <table className="w-full text-left">
          <thead className="border-b-[2.5px] border-ink font-mono text-xs uppercase">
            <tr><th className="p-4">Name</th><th className="p-4">Email</th><th className="p-4">Role</th><th className="p-4" /></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-ink/20">
                <td className="p-4 font-bold">{m.name}{m.userId === session.user.id && " (you)"}</td>
                <td className="p-4">{m.email}</td>
                <td className="p-4">
                  {isAdmin ? (
                    <form action={changeRoleAction} className="flex gap-2">
                      <input type="hidden" name="userId" value={m.userId} />
                      <select name="role" defaultValue={m.role} className="border-brutal px-2 py-1">
                        <option value="member">member</option><option value="admin">admin</option>
                      </select>
                      <Button className="px-3 py-1">Save</Button>
                    </form>
                  ) : <span className="font-mono uppercase">{m.role}</span>}
                </td>
                <td className="p-4 text-right">
                  {(isAdmin || m.userId === session.user.id) && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button className="px-3 py-1">{m.userId === session.user.id ? "Leave" : "Remove"}</Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {isAdmin && invites.length > 0 && (
        <Card>
          <h2 className="mb-4 font-display text-2xl">Pending invitations</h2>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between border-b border-ink/20 pb-2">
                <span>{i.email} <span className="font-mono text-xs uppercase">({i.role})</span></span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="invitationId" value={i.id} />
                  <Button className="px-3 py-1">Revoke</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Invite acceptance page**

`src/app/invite/[token]/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { acceptInvitation } from "@/server/team/service";
import { setActiveTenantCookie } from "@/server/tenants/current";
import { DomainError } from "@/server/errors";

export async function acceptInviteAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const token = z.string().min(20).max(200).parse(form.get("token"));
  let tenantId: string;
  try {
    ({ tenantId } = await acceptInvitation({ token, userId: session.user.id, userEmail: session.user.email }));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  await setActiveTenantCookie(tenantId);
  redirect("/dashboard");
}
```

`src/app/invite/[token]/page.tsx`:
```tsx
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
            <p className="mt-3">Signed in as <b>{session.user.email}</b>.</p>
            <AcceptButton token={token} />
          </>
        ) : (
          <div className="mt-6 flex gap-3">
            <Link href={`/signup?next=${next}`} className="border-brutal shadow-hard-sm bg-red px-5 py-3 font-bold uppercase text-white">Sign up</Link>
            <Link href={`/login?next=${next}`} className="border-brutal shadow-hard-sm px-5 py-3 font-bold uppercase">Log in</Link>
          </div>
        )}
      </Card>
    </main>
  );
}
```

Create `src/app/invite/[token]/accept-button.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "./actions";
import { Button } from "@/components/ui/button";

export function AcceptButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, {});
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{state.error}</p>}
      <Button variant="primary" disabled={pending} className="w-full justify-center">{pending ? "Joining..." : "Join workspace"}</Button>
    </form>
  );
}
```

Also update `AuthForm` so that after signup with a `next` of `/invite/...` it goes to `next` (already handled: only a default `next` goes to `/onboarding`).

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: team invitations, roles and member removal"
```

---

### Task 6: End-to-end test of the foundation flow

**Files:**
- Create: `playwright.config.ts`, `e2e/team.spec.ts`

**Interfaces:**
- Consumes: all pages from Tasks 3-5; dev DB from Task 1 migrated in Task 2.

- [ ] **Step 1: Playwright config**

```bash
npx playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
```

- [ ] **Step 2: Write the e2e test**

`e2e/team.spec.ts`:
```ts
import { test, expect, type Page } from "@playwright/test";

const stamp = Date.now();
const owner = { name: "Olive Owner", email: `owner-${stamp}@e2e.dev`, password: "correct-horse-1" };
const mate = { name: "Mo Mate", email: `mate-${stamp}@e2e.dev`, password: "correct-horse-2" };

async function signUp(page: Page, u: typeof owner, next?: string) {
  await page.goto(next ? `/signup?next=${encodeURIComponent(next)}` : "/signup");
  await page.getByLabel("Your name").fill(u.name);
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("owner creates a workspace, invites a teammate who joins", async ({ browser }) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await signUp(ownerPage, owner);
  await expect(ownerPage).toHaveURL(/\/onboarding/);
  await ownerPage.getByLabel("Workspace name").fill(`E2E Co ${stamp}`);
  await ownerPage.getByRole("button", { name: "Create workspace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Envelopes" })).toBeVisible();

  await ownerPage.goto("/settings/team");
  await ownerPage.getByLabel("Email").fill(mate.email.toUpperCase());
  await ownerPage.getByRole("button", { name: "Invite" }).click();
  const inviteUrl = await ownerPage.getByTestId("invite-url").inputValue();
  expect(inviteUrl).toContain("/invite/");

  const matePage = await (await browser.newContext()).newPage();
  await matePage.goto(inviteUrl);
  await matePage.getByRole("link", { name: "Sign up" }).click();
  await matePage.getByLabel("Your name").fill(mate.name);
  await matePage.getByLabel("Work email").fill(mate.email);
  await matePage.getByLabel("Password").fill(mate.password);
  await matePage.getByRole("button", { name: "Create account" }).click();
  await matePage.getByRole("button", { name: "Join workspace" }).click();
  await expect(matePage.getByRole("heading", { name: "Envelopes" })).toBeVisible();

  await ownerPage.reload();
  await expect(ownerPage.getByRole("cell", { name: mate.email })).toBeVisible();
});

test("unauthenticated users are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Run**

Prereqs: `docker compose -f compose.dev.yml up -d` and `npm run db:migrate`.
Run: `npm run e2e`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: end-to-end signup, workspace and invitation flow"
```

---

## Self-review notes

- Spec coverage for this plan: section 2 tenants/roles/invites (Tasks 4-5), section 3 layout and rules (all tasks), section 4 tenants/memberships/invitations + tenant isolation incl. migrator/app roles, definer functions and leak tests (Task 2), section 8 design language (Task 1), section 9 zod + DomainError mapping (Tasks 3-5), section 10 unit/integration/e2e (all). Envelopes, signing, worker, deployment and marketing are Plans 2-5.
- Review Focus items 1-5 are pinned in Tasks 5, 4, 5, 5, 3 respectively.
