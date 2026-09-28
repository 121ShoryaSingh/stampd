# Stampd Plan 1b: Move the data layer to Prisma

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace Drizzle with Prisma 7 everywhere, with no hand-written SQL in application code, while keeping database-enforced tenant isolation (Postgres RLS). All Plan 1 behavior and tests keep passing; Plan 2 Task 2 (envelope tables) lands on Prisma.

**Why:** User direction (2026-09-28): "use prisma and dont write a hard query in the code". User chose database-enforced isolation over app-only filtering.

**Spec:** `docs/superpowers/specs/2026-09-28-stampd-design.md` section 4 "Tenant isolation" (unchanged intent).

## Global Constraints

- Prisma `7.10.0` (`prisma`, `@prisma/client`), `@prisma/adapter-pg`, `pg`, `@better-auth/prisma-adapter`. Do not use the `prisma` npm `latest` tag (it points at 8.0 rc).
- Generator `prisma-client`, output `src/generated/prisma` (git-ignored, generated on install and before tests/build).
- App code never calls `$queryRaw`, `$executeRaw`, `$queryRawUnsafe` or `$executeRawUnsafe`. The single exception is the context line in `src/server/db/context.ts`. A test enforces this.
- SQL lives only in `prisma/migrations/*/migration.sql` (RLS policies, grants, helper functions).
- Tables and columns keep snake_case names via `@@map`/`@map`.
- Roles unchanged: app connects as `stampd_app`; `stampd_migrator` (BYPASSRLS, now also CREATEDB for Prisma's shadow database) runs migrations.
- Row locks are expressed with Prisma writes: a conditional `updateMany` claims a state transition; touching a parent row (`updatedAt`) serializes concurrent writers.

## Design

- `withDb({ tenantId?, userId?, tokenHash? }, fn)` opens an interactive transaction, sets `app.tenant_id`, `app.user_id`, `app.token_hash` (transaction-local), runs `fn(tx)`. `withTenant(id, fn)` is `withDb({ tenantId: id }, fn)`.
- RLS policies (permissive, OR-ed per table):
  - every tenant table: `tenant_isolation` FOR ALL using/with check `tenant_id = app_tenant_id()` (`tenants` uses `id`).
  - `memberships`: extra SELECT policy `user_id = app_user_id()` (list my workspaces).
  - `tenants`: extra SELECT policy "a membership row for `app_user_id()` exists".
  - `invitations`: extra SELECT policy `token_hash = app_token_hash()` (open an invite link).
  - `audit_events`: app role has no UPDATE/DELETE/TRUNCATE.
- The two SECURITY DEFINER functions from Plan 1 are dropped; those lookups become Prisma queries under the policies above.
- Audit chain order: `envelopes.audit_seq` is incremented in the same transaction as each append (`update ... increment`), which row-locks the envelope; `audit_events` has `unique(envelope_id, seq)`.
- Draft lock: `envelope.updateMany({ where: { id, status: "draft" }, data: { updatedAt } })`; count 0 means not found or not draft.
- Last-admin guard: `tenant.update({ data: { updatedAt } })` first, then count admins.
- Invitation accept: `invitation.updateMany({ where: { id, acceptedAt: null, expiresAt: { gt: now } }, data: { acceptedAt } })`; count 0 means invalid, expired or reused.

## Tasks

### Task 1: Prisma setup, schema, migrations, context wrapper
- [ ] Remove Drizzle (`drizzle-orm`, `drizzle-kit`, `postgres`, `drizzle/`, `drizzle.config.ts`, `src/server/db/{schema,auth-schema,migrate,tenant}.ts`, `src/server/db/sql/`, `scripts/migrate.mts`).
- [ ] Install Prisma deps; add `prisma.config.ts` (datasource `MIGRATOR_DATABASE_URL`, loads `.env.local`), `prisma/schema.prisma` with all Plan 1 models plus Plan 2 envelope models.
- [ ] Give `stampd_migrator` CREATEDB (dev init.sql, test harness); reset the dev database.
- [ ] Migrations: `init` (generated), `rls` (hand-written policies, grants, helper functions).
- [ ] `src/server/db/client.ts` (PrismaClient + PrismaPg), `src/server/db/context.ts` (`withDb`, `withTenant`, `Tx`), `src/server/db/types.ts` (re-export enums as types).
- [ ] Test harness: `prisma migrate deploy` against the container; `tests/helpers/db.ts` becomes a migrator Prisma client (`adminDb()`), `insertUser`, `insertTenant`.
- [ ] Tests: RLS for Plan 1 tables + envelope tables (ported from Drizzle versions), including "my memberships only", "invite by token only", audit append-only, and a "no raw SQL outside context.ts" source scan.

### Task 2: Port services and Better Auth
- [ ] Better Auth: `@better-auth/prisma-adapter` with the shared client.
- [ ] Port `tenants/service.ts`, `team/service.ts` to Prisma with the lock patterns above; keep every exported signature from Plan 1.
- [ ] Port all Plan 1 tests (service, team) to the Prisma helpers; e2e unchanged.
- [ ] Full suite, build, e2e green.

## Review Focus

1. A query run without any context (no tenant, user or token) must see nothing. Pinned in Task 1 RLS tests.
2. The "my workspaces" and "invite link" policies must not widen access beyond one user's memberships or one token's invitation. Pinned in Task 1 RLS tests.
3. Two admins demoting each other at the same time must leave at least one admin. Pinned in Task 2 (concurrent changeRole test).
4. A raw query sneaking into app code. Pinned in Task 1 (source scan test).
