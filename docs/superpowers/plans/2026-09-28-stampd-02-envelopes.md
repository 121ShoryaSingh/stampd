# Stampd Plan 2: Envelopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sender can create an envelope, upload a PDF, add recipients with a signing order, place fields on the pages, and send it, with every step recorded in a hash-chained audit log.

**Architecture:** New tenant tables (envelopes, documents, recipients, fields, audit_events) under the same RLS pattern as Plan 1. Storage goes through `@khair/storage-adapter` (the same adapter as POS and Horizon), wrapped in `src/server/storage/storage.ts`. PDFs go browser -> bucket directly via a presigned PUT; a PUT cannot cap size, so the server downloads the object, enforces size/type/PDF validity, and deletes anything it rejects. All rules live in `src/server/envelopes/*` services; pages call them through server actions. The field editor renders pages with pdf.js in the browser and stores field boxes as fractions (0..1) of the page size.

**Tech Stack:** as Plan 1, plus `@khair/storage-adapter` (with its S3 peers `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`), `pdf-lib`, `pdfjs-dist`, MinIO (dev and tests).

**Spec:** `docs/superpowers/specs/2026-09-28-stampd-design.md` (sections 2, 4, 5 "Uploads", 7, 8). Plan 2 of 5. Builds on branch `plan-1-foundation`. The audit log (spec section 7) moves here from Plan 3 because create/upload/send events happen in this plan.

## Global Constraints

- Everything in Plan 1's Global Constraints still applies (UUIDv7, timestamptz, RLS with ENABLE + FORCE, `server-only`, zod on every action, ASCII only, LF, short one-line comments, Neo-Brutalist design).
- Ports: app 3100, dev Postgres 5433, dev MinIO 9100 (API) and 9101 (console).
- Uploads: `application/pdf` only, max 25 MB (`26_214_400` bytes), max 200 pages, checked server-side after upload with pdf-lib (a presigned PUT cannot enforce size, so the server is the gate and deletes rejected objects).
- All storage access goes through `src/server/storage/storage.ts`; nothing else imports `@khair/storage-adapter` or an AWS SDK.
- One document per envelope in v1.
- Field coordinates are fractions of page width/height: `0 <= x, y`, `w, h > 0`, `x + w <= 1`, `y + h <= 1`; `y` measured from the top of the page.
- Only `draft` envelopes are editable. Status transitions lock the envelope row (`for update`) and append an audit event in the same transaction.
- Max 20 recipients per envelope; recipient emails unique per envelope (normalized).
- S3 object keys: `t/<tenantId>/e/<envelopeId>/<uuid>.pdf`.
- Signer links are `<BETTER_AUTH_URL>/sign/<token>`; the token is 32 random bytes base64url, only its SHA-256 is stored. (The signer page itself is Plan 3; emails are Plan 4, so this plan shows links in the UI.)

## Review Focus

1. A file that is not really a PDF (renamed `.txt`, truncated, or garbage bytes) must be rejected with a clear message and leave no document row. Pinned in Task 4 (`finalizeUpload` rejects non-PDF and corrupt bytes).
2. Editing recipients or fields after sending must be rejected, because signers are already looking at that version. Pinned in Task 5 (`setRecipients`/`saveFields` on a sent envelope throw InvalidState).
3. Clicking Send twice (double click or two tabs) must send once; the second attempt gets a clear "already sent" error. Pinned in Task 6 (concurrent `sendEnvelope` test).
4. A field dragged partly off the page, or on a page that does not exist, must be rejected by the server even if the browser allowed it. Pinned in Task 5.
5. A forged upload key pointing at another workspace's or envelope's object must be rejected. Pinned in Task 4 (`finalizeUpload` key check).
6. A file over 25 MB uploaded straight to the signed URL (bypassing the browser check) must be rejected and deleted. Pinned in Task 4 (oversize test).

---

## File Structure

```
compose.dev.yml                              + minio service
.env.example                                 + S3_* vars
src/server/env.ts                            + S3_* vars
src/server/errors.ts                         + InvalidStateError
src/server/storage/storage.ts                wraps @khair/storage-adapter: presignUpload, presignGet, getObjectBytes, putObject, deleteObject
src/server/db/schema.ts                      + envelopes, documents, recipients, fields, audit_events
src/server/db/sql/rls.sql                    + RLS for the new tables, audit append-only
src/server/audit/canonical.ts                canonicalJson()
src/server/audit/service.ts                  appendAudit(), verifyChain(), listAudit()
src/server/envelopes/keys.ts                 uploadKeyFor(), isUploadKeyFor()
src/server/envelopes/pdf.ts                  inspectPdf()
src/server/envelopes/service.ts              create, get, list, upload, delete, void
src/server/envelopes/recipients.ts           setRecipients()
src/server/envelopes/fields.ts               saveFields(), validateFieldBox()
src/server/envelopes/send.ts                 sendEnvelope()
src/lib/fields/geometry.ts                   client+server geometry helpers
src/app/api/uploads/presign/route.ts
src/app/(app)/dashboard/page.tsx             envelope list + status filters (replace)
src/app/(app)/envelopes/new/page.tsx, upload-form.tsx, actions.ts
src/app/(app)/envelopes/[id]/page.tsx, actions.ts, send-form.tsx
src/app/(app)/envelopes/[id]/edit/page.tsx, actions.ts, editor.tsx, recipients-form.tsx, pdf-canvas.tsx
src/components/app/status-pill.tsx
tests/global-setup.ts                        + MinIO container
tests/setup.ts                               + S3 env
tests/helpers/pdf.ts                         makePdf()
tests/helpers/envelopes.ts                   seedDraft()
tests/db/rls-envelopes.test.ts
e2e/send.spec.ts
```

---

### Task 1: Object storage (@khair/storage-adapter + MinIO)

**Files:**
- Create: `src/server/storage/storage.ts`, `src/server/storage/storage.test.ts`
- Modify: `compose.dev.yml`, `.env.example`, `.env.local`, `src/server/env.ts`, `tests/global-setup.ts`, `tests/setup.ts`, `package.json`

**Interfaces:**
- Produces (the only storage API the rest of the app may use):
  - `presignUpload(key: string, contentType: string, expiresSec?: number): Promise<string>` (a URL the browser PUTs to, with header `Content-Type: <contentType>`)
  - `presignGet(key: string, expiresSec?: number): Promise<string>`
  - `getObjectBytes(key: string): Promise<Uint8Array>` (throws `NotFoundError` if missing)
  - `objectExists(key: string): Promise<boolean>`
  - `putObject(key: string, body: Uint8Array, contentType: string): Promise<void>`
  - `deleteObject(key: string): Promise<void>` (no error if already gone)
  - env: `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT` (MinIO/R2; unset for real AWS), optional `S3_ACCESS_KEY` + `S3_SECRET_KEY` (unset = AWS default credential chain, like Horizon)

- [ ] **Step 1: Dependencies**

```bash
npm i @khair/storage-adapter @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner pdf-lib pdfjs-dist
```
The adapter's GCS and Azure peers are optional and not needed.

- [ ] **Step 2: Dev MinIO**

Append to `compose.dev.yml` under `services:`:
```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: stampd
      MINIO_ROOT_PASSWORD: stampd-minio-secret
    ports: ["127.0.0.1:9100:9000", "127.0.0.1:9101:9001"]
    volumes: [miniodata:/data]
  minio-init:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "until mc alias set local http://minio:9000 stampd stampd-minio-secret; do sleep 1; done;
      mc mb -p local/stampd-dev; exit 0"
```
and add `miniodata:` under `volumes:`.

Append to `.env.example` and `.env.local`:
```
S3_ENDPOINT=http://localhost:9100
S3_REGION=us-east-1
S3_BUCKET=stampd-dev
S3_ACCESS_KEY=stampd
S3_SECRET_KEY=stampd-minio-secret
```

Run: `docker compose -f compose.dev.yml up -d && docker compose -f compose.dev.yml logs minio-init | tail -3`
Expected: `Bucket created successfully` (or already exists).

- [ ] **Step 3: Env**

Replace the schema in `src/server/env.ts`:
```ts
const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  S3_BUCKET: z.string().min(3),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(), // MinIO / R2; leave unset for AWS S3
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
});
```

- [ ] **Step 4: MinIO in the test harness**

In `tests/global-setup.ts` add imports:
```ts
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
```
Add `let minio: StartedTestContainer | undefined;` next to `container`, and before `project.provide(...)`:
```ts
  minio = await new GenericContainer("minio/minio:latest")
    .withCommand(["server", "/data"])
    .withEnvironment({ MINIO_ROOT_USER: "test", MINIO_ROOT_PASSWORD: "test-secret-123" })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
    .start();
  const s3Url = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  const s3 = new S3Client({ endpoint: s3Url, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test-secret-123" } });
  await s3.send(new CreateBucketCommand({ Bucket: "stampd-test" }));
  project.provide("s3Url", s3Url);
```
Change the teardown to `await Promise.all([container?.stop(), minio?.stop()]);` and add `s3Url: string;` to `ProvidedContext`.

Append to `tests/setup.ts`:
```ts
process.env.S3_ENDPOINT = inject("s3Url");
process.env.S3_REGION = "us-east-1";
process.env.S3_BUCKET = "stampd-test";
process.env.S3_ACCESS_KEY = "test";
process.env.S3_SECRET_KEY = "test-secret-123";
```

- [ ] **Step 5: Write the failing storage test**

`src/server/storage/storage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { presignUpload, presignGet, getObjectBytes, objectExists, putObject, deleteObject } from "./storage";
import { NotFoundError } from "@/server/errors";

const key = () => `t/test/e/test/${randomUUID()}.pdf`;

describe("storage", () => {
  it("round-trips an object via presigned PUT and GET", async () => {
    const k = key();
    const url = await presignUpload(k, "application/pdf");
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: "%PDF-hello" });
    expect(put.status).toBe(200);
    expect(new TextDecoder().decode(await getObjectBytes(k))).toBe("%PDF-hello");
    expect(await (await fetch(await presignGet(k))).text()).toBe("%PDF-hello");
  });

  it("reports existence and deletes", async () => {
    const k = key();
    expect(await objectExists(k)).toBe(false);
    await putObject(k, new Uint8Array([1, 2]), "application/pdf");
    expect(await objectExists(k)).toBe(true);
    await deleteObject(k);
    expect(await objectExists(k)).toBe(false);
    await expect(deleteObject(k)).resolves.toBeUndefined();
  });

  it("throws NotFoundError for a missing key", async () => {
    await expect(getObjectBytes(key())).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

Run: `npx vitest run src/server/storage`
Expected: FAIL, cannot find `./storage`.

- [ ] **Step 6: Implement the wrapper**

`src/server/storage/storage.ts`:
```ts
import "server-only";
import { createStorageAdapter, StorageOperationError } from "@khair/storage-adapter";
import { env } from "@/server/env";
import { NotFoundError } from "@/server/errors";

// Same adapter as POS and Horizon; static keys only when given, else the AWS default chain.
const adapter = createStorageAdapter({
  provider: "s3",
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : {}),
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
});

const notFound = (e: unknown) => e instanceof StorageOperationError && e.code === "NOT_FOUND";

export function presignUpload(key: string, contentType: string, expiresSec = 300): Promise<string> {
  return adapter.getSignedUploadUrl(key, { contentType, expiresInSeconds: expiresSec });
}

export function presignGet(key: string, expiresSec = 300): Promise<string> {
  return adapter.getSignedUrl(key, { expiresInSeconds: expiresSec });
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await adapter.download(key));
  } catch (e) {
    if (notFound(e)) throw new NotFoundError("File not found");
    throw e;
  }
}

export function objectExists(key: string): Promise<boolean> {
  return adapter.exists(key);
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await adapter.upload(key, body, { contentType });
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await adapter.delete(key);
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}
```

Run: `npx vitest run src/server/storage`
Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
npm test
git add -A
git commit -m "feat: object storage via @khair/storage-adapter with MinIO for dev and tests"
```

---

### Task 2: Envelope tables with RLS

**Files:**
- Modify: `src/server/db/schema.ts`, `src/server/db/sql/rls.sql`, `src/server/errors.ts`
- Create: `tests/db/rls-envelopes.test.ts`, `tests/helpers/envelopes.ts`
- Generated: `drizzle/0001_*.sql`

**Interfaces:**
- Consumes: `tenants`, `user`, `withTenant` (Plan 1).
- Produces: tables `envelopes`, `documents`, `recipients`, `fields`, `auditEvents`; types `EnvelopeStatus`, `RecipientRole`, `RecipientStatus`, `FieldType`, `PageSize = { w: number; h: number }`; `InvalidStateError`; test helper `seedDraft(sql, tenantId, userId, title?)` returning the envelope id.

- [ ] **Step 1: Error type**

Append to `src/server/errors.ts`:
```ts
export class InvalidStateError extends DomainError {}
```

- [ ] **Step 2: Schema**

Add to `src/server/db/schema.ts` (extend the imports with `integer, boolean, doublePrecision, jsonb, bigserial`):
```ts
export const envelopeStatusEnum = pgEnum("envelope_status", ["draft", "sent", "completed", "declined", "voided", "expired"]);
export const recipientRoleEnum = pgEnum("recipient_role", ["signer", "cc"]);
export const recipientStatusEnum = pgEnum("recipient_status", ["pending", "sent", "viewed", "signed", "declined"]);
export const fieldTypeEnum = pgEnum("field_type", ["signature", "initials", "date", "text", "checkbox"]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "recipient", "system"]);

export type EnvelopeStatus = (typeof envelopeStatusEnum.enumValues)[number];
export type RecipientRole = (typeof recipientRoleEnum.enumValues)[number];
export type RecipientStatus = (typeof recipientStatusEnum.enumValues)[number];
export type FieldType = (typeof fieldTypeEnum.enumValues)[number];
export type PageSize = { w: number; h: number };

const tenantRef = () => uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const envelopes = pgTable(
  "envelopes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: tenantRef(),
    createdBy: text("created_by").notNull().references(() => user.id),
    title: text("title").notNull(),
    message: text("message"),
    status: envelopeStatusEnum("status").notNull().default("draft"),
    expiresAt: ts("expires_at"),
    reminderEveryDays: integer("reminder_every_days"),
    lastError: text("last_error"),
    sentAt: ts("sent_at"),
    completedAt: ts("completed_at"),
    voidedAt: ts("voided_at"),
    voidReason: text("void_reason"),
    sealedS3Key: text("sealed_s3_key"),
    sealedSha256: text("sealed_sha256"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("envelopes_tenant_status_idx").on(t.tenantId, t.status, t.createdAt)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: tenantRef(),
    envelopeId: uuid("envelope_id").notNull().references(() => envelopes.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    s3Key: text("s3_key").notNull(),
    sha256: text("sha256").notNull(),
    pageCount: integer("page_count").notNull(),
    pageSizes: jsonb("page_sizes").$type<PageSize[]>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("documents_envelope_idx").on(t.envelopeId)],
);

export const recipients = pgTable(
  "recipients",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: tenantRef(),
    envelopeId: uuid("envelope_id").notNull().references(() => envelopes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: recipientRoleEnum("role").notNull().default("signer"),
    routingOrder: integer("routing_order").notNull().default(1),
    status: recipientStatusEnum("status").notNull().default("pending"),
    tokenHash: text("token_hash"),
    otpHash: text("otp_hash"),
    otpExpiresAt: ts("otp_expires_at"),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    consentedAt: ts("consented_at"),
    viewedAt: ts("viewed_at"),
    signedAt: ts("signed_at"),
    declinedAt: ts("declined_at"),
    declineReason: text("decline_reason"),
    lastRemindedAt: ts("last_reminded_at"),
    signIp: text("sign_ip"),
    signUserAgent: text("sign_user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recipients_envelope_email_idx").on(t.envelopeId, t.email), uniqueIndex("recipients_token_idx").on(t.tokenHash)],
);

export const fields = pgTable(
  "fields",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: tenantRef(),
    envelopeId: uuid("envelope_id").notNull().references(() => envelopes.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id").notNull().references(() => recipients.id, { onDelete: "cascade" }),
    type: fieldTypeEnum("type").notNull(),
    page: integer("page").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    w: doublePrecision("w").notNull(),
    h: doublePrecision("h").notNull(),
    required: boolean("required").notNull().default(true),
    value: text("value"),
    signatureS3Key: text("signature_s3_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("fields_envelope_idx").on(t.envelopeId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: tenantRef(),
    envelopeId: uuid("envelope_id").notNull().references(() => envelopes.id, { onDelete: "cascade" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    event: text("event").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_envelope_idx").on(t.envelopeId, t.id)],
);
```

Run: `npm run db:generate`
Expected: `drizzle/0001_*.sql` with 5 new tables and 5 enums.

- [ ] **Step 3: RLS for the new tables**

Append to `src/server/db/sql/rls.sql` (before the definer functions):
```sql
do $$
declare t text;
begin
  foreach t in array array['envelopes', 'documents', 'recipients', 'fields', 'audit_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- Audit log is append-only for the app.
revoke update, delete, truncate on audit_events from stampd_app;
```
Note: the earlier `grant select, insert, update, delete on all tables` line runs first on every migrate, so the `revoke` must stay after it in the file.

- [ ] **Step 4: Test helper**

`tests/helpers/envelopes.ts`:
```ts
import type { migratorSql } from "./db";

export async function seedDraft(sql: ReturnType<typeof migratorSql>, tenantId: string, userId: string, title = "Draft") {
  const [row] = await sql<{ id: string }[]>`
    insert into envelopes (id, tenant_id, created_by, title) values (gen_random_uuid(), ${tenantId}, ${userId}, ${title})
    returning id`;
  return row.id;
}
```

- [ ] **Step 5: Write the failing RLS test**

`tests/db/rls-envelopes.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migratorSql, insertUser, insertTenant } from "../helpers/db";
import { seedDraft } from "../helpers/envelopes";
import { withTenant } from "@/server/db/tenant";
import { envelopes, recipients, auditEvents } from "@/server/db/schema";
import { sql as dsql } from "drizzle-orm";

const admin = migratorSql();
let a: string, b: string, envB: string;

beforeAll(async () => {
  a = await insertTenant(admin, "EnvA");
  b = await insertTenant(admin, "EnvB");
  const u = await insertUser(admin);
  await seedDraft(admin, a, u.id, "mine");
  envB = await seedDraft(admin, b, u.id, "theirs");
  await admin`insert into recipients (id, tenant_id, envelope_id, name, email) values (gen_random_uuid(), ${b}, ${envB}, 'R', 'r@b.dev')`;
  await admin`insert into audit_events (tenant_id, envelope_id, actor_type, event, created_at, hash) values (${b}, ${envB}, 'system', 'created', now(), 'h')`;
});
afterAll(async () => {
  await admin.end();
});

describe("envelope tables RLS", () => {
  it("lists only the current tenant's envelopes", async () => {
    const rows = await withTenant(a, (tx) => tx.select().from(envelopes));
    expect(rows.map((r) => r.title)).toEqual(["mine"]);
  });

  it("hides another tenant's recipients and audit events", async () => {
    const [r, e] = await withTenant(a, async (tx) => [await tx.select().from(recipients), await tx.select().from(auditEvents)]);
    expect(r).toHaveLength(0);
    expect(e).toHaveLength(0);
  });

  it("cannot attach a recipient to another tenant's envelope", async () => {
    await expect(
      withTenant(a, (tx) => tx.insert(recipients).values({ tenantId: b, envelopeId: envB, name: "X", email: "x@x.dev" })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });

  it("the app cannot update or delete audit events", async () => {
    await expect(withTenant(b, (tx) => tx.execute(dsql`update audit_events set event = 'x'`))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/permission denied/) },
    });
    await expect(withTenant(b, (tx) => tx.execute(dsql`delete from audit_events`))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/permission denied/) },
    });
  });
});
```

Run: `npx vitest run tests/db/rls-envelopes.test.ts` with the RLS block and revoke temporarily removed from `rls.sql` (to watch it fail), then restore them.
Expected without the block: FAIL (tenant A sees B's rows; update succeeds). With the block: 4 PASS.

- [ ] **Step 6: Migrate dev and commit**

```bash
npm run db:migrate
npm test
git add -A
git commit -m "feat: envelope, document, recipient, field and audit tables with RLS"
```

---

### Task 3: Hash-chained audit log

**Files:**
- Create: `src/server/audit/canonical.ts`, `src/server/audit/canonical.test.ts`, `src/server/audit/service.ts`, `src/server/audit/service.test.ts`

**Interfaces:**
- Consumes: `auditEvents`, `Tx`, `withTenant` (Task 2 / Plan 1).
- Produces:
  - `canonicalJson(value: unknown): string` (sorted keys, no whitespace)
  - `type AuditInput = { tenantId: string; envelopeId: string; actorType: "user" | "recipient" | "system"; actorId?: string | null; event: string; ip?: string | null; userAgent?: string | null; data?: Record<string, unknown> }`
  - `appendAudit(tx: Tx, e: AuditInput): Promise<{ id: number; hash: string }>`
  - `verifyChain(tx: Tx, envelopeId: string): Promise<{ ok: true; lastHash: string | null } | { ok: false; brokenAtId: number }>`
  - `listAudit(tx: Tx, envelopeId: string)` returning rows ordered by id

- [ ] **Step 1: Write the failing canonical test**

`src/server/audit/canonical.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { canonicalJson } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it("drops undefined values like JSON does", () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});
```

Run: `npx vitest run src/server/audit/canonical.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement canonical.ts**

```ts
// Stable JSON: same data always gives the same string, so hashes are reproducible.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
```

Run: `npx vitest run src/server/audit/canonical.test.ts`
Expected: 2 PASS.

- [ ] **Step 3: Write the failing service test**

`src/server/audit/service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migratorSql, insertUser, insertTenant } from "../../../tests/helpers/db";
import { seedDraft } from "../../../tests/helpers/envelopes";
import { withTenant } from "@/server/db/tenant";
import { appendAudit, verifyChain, listAudit } from "./service";

const admin = migratorSql();
let tenantId: string, envelopeId: string;

beforeAll(async () => {
  tenantId = await insertTenant(admin, "Audit");
  const u = await insertUser(admin);
  envelopeId = await seedDraft(admin, tenantId, u.id);
});
afterAll(async () => {
  await admin.end();
});

const ev = (event: string) => ({ tenantId, envelopeId, actorType: "system" as const, event, data: { n: event } });

describe("audit log", () => {
  it("chains each event to the previous hash", async () => {
    const e1 = await withTenant(tenantId, (tx) => appendAudit(tx, ev("created")));
    const e2 = await withTenant(tenantId, (tx) => appendAudit(tx, ev("sent")));
    const rows = await withTenant(tenantId, (tx) => listAudit(tx, envelopeId));
    expect(rows.map((r) => r.event)).toEqual(["created", "sent"]);
    expect(rows[1].prevHash).toBe(e1.hash);
    expect(e2.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await withTenant(tenantId, (tx) => verifyChain(tx, envelopeId))).toEqual({ ok: true, lastHash: e2.hash });
  });

  it("detects a tampered event", async () => {
    await admin`update audit_events set data = '{"n":"forged"}' where envelope_id = ${envelopeId} and event = 'created'`;
    const res = await withTenant(tenantId, (tx) => verifyChain(tx, envelopeId));
    expect(res.ok).toBe(false);
  });

  it("keeps the chain linear under concurrent appends", async () => {
    const u = await insertUser(admin);
    const env2 = await seedDraft(admin, tenantId, u.id);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withTenant(tenantId, (tx) => appendAudit(tx, { tenantId, envelopeId: env2, actorType: "system", event: `e${i}` })),
      ),
    );
    expect((await withTenant(tenantId, (tx) => verifyChain(tx, env2))).ok).toBe(true);
  });
});
```

Run: `npx vitest run src/server/audit/service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the service**

`src/server/audit/service.ts`:
```ts
import "server-only";
import { createHash } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/tenant";
import { auditEvents } from "@/server/db/schema";
import { canonicalJson } from "./canonical";

export type AuditInput = {
  tenantId: string;
  envelopeId: string;
  actorType: "user" | "recipient" | "system";
  actorId?: string | null;
  event: string;
  ip?: string | null;
  userAgent?: string | null;
  data?: Record<string, unknown>;
};

type Hashable = Required<Omit<AuditInput, "data">> & { data: Record<string, unknown>; createdAt: string };

function hashEvent(prevHash: string | null, e: Hashable): string {
  return createHash("sha256").update(`${prevHash ?? ""}|${canonicalJson(e)}`).digest("hex");
}

export async function appendAudit(tx: Tx, e: AuditInput): Promise<{ id: number; hash: string }> {
  // One writer per envelope at a time keeps the chain linear.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${e.envelopeId}))`);
  const [last] = await tx
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.envelopeId, e.envelopeId))
    .orderBy(desc(auditEvents.id))
    .limit(1);
  const prevHash = last?.hash ?? null;
  const createdAt = new Date();
  const h: Hashable = {
    tenantId: e.tenantId,
    envelopeId: e.envelopeId,
    actorType: e.actorType,
    actorId: e.actorId ?? null,
    event: e.event,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    data: e.data ?? {},
    createdAt: createdAt.toISOString(),
  };
  const hash = hashEvent(prevHash, h);
  const [row] = await tx
    .insert(auditEvents)
    .values({ ...h, createdAt, prevHash, hash })
    .returning({ id: auditEvents.id });
  return { id: row.id, hash };
}

export async function listAudit(tx: Tx, envelopeId: string) {
  return tx.select().from(auditEvents).where(eq(auditEvents.envelopeId, envelopeId)).orderBy(asc(auditEvents.id));
}

export async function verifyChain(tx: Tx, envelopeId: string) {
  let prev: string | null = null;
  for (const r of await listAudit(tx, envelopeId)) {
    const expected = hashEvent(prev, {
      tenantId: r.tenantId,
      envelopeId: r.envelopeId,
      actorType: r.actorType,
      actorId: r.actorId,
      event: r.event,
      ip: r.ip,
      userAgent: r.userAgent,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
    });
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false as const, brokenAtId: r.id };
    prev = r.hash;
  }
  return { ok: true as const, lastHash: prev };
}
```
Note: Postgres stores microseconds, JS Dates hold milliseconds, so `createdAt.toISOString()` round-trips exactly because we write a JS Date.

Run: `npx vitest run src/server/audit`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
npm test
git add -A
git commit -m "feat: hash-chained append-only audit log"
```

---

### Task 4: Envelope drafts and PDF upload

**Files:**
- Create: `src/server/envelopes/keys.ts`, `src/server/envelopes/pdf.ts`, `src/server/envelopes/service.ts`, `src/server/envelopes/service.test.ts`, `tests/helpers/pdf.ts`

**Interfaces:**
- Consumes: storage (Task 1), tables + `InvalidStateError` (Task 2), `appendAudit` (Task 3), `withTenant`, errors.
- Produces:
  - `MAX_UPLOAD_BYTES = 26_214_400`, `MAX_PAGES = 200`
  - `uploadKeyFor(tenantId: string, envelopeId: string): string`, `isUploadKeyFor(key: string, tenantId: string, envelopeId: string): boolean`
  - `inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number; pageSizes: PageSize[] }>` (throws `ValidationError`)
  - `createEnvelope(i: { tenantId; userId; title }): Promise<{ id: string }>`
  - `createUploadUrl(i: { tenantId; envelopeId }): Promise<{ url: string; key: string }>` (url is a presigned PUT)
  - `finalizeUpload(i: { tenantId; userId; envelopeId; key; filename }): Promise<{ documentId: string; pageCount: number }>`
  - `getEnvelope(tenantId, envelopeId)`: `{ envelope, document: Document | null, recipients: Recipient[], fields: Field[] }` (throws `NotFoundError`)
  - `listEnvelopes(tenantId, filter?: { status?: EnvelopeStatus })`: `{ id, title, status, createdAt, sentAt, recipientCount, signedCount }[]`
  - `countByStatus(tenantId): Promise<Record<EnvelopeStatus, number>>`
  - `deleteDraft(i: { tenantId; envelopeId }): Promise<void>`
  - `voidEnvelope(i: { tenantId; userId; envelopeId; reason }): Promise<void>`
  - `lockDraft(tx: Tx, envelopeId: string)` (select for update, throws NotFound / InvalidState if not draft)
  - test helper `makePdf(pages?: number, size?: [number, number]): Promise<Uint8Array>`

- [ ] **Step 1: PDF test helper**

`tests/helpers/pdf.ts`:
```ts
import { PDFDocument } from "pdf-lib";

export async function makePdf(pages = 1, size: [number, number] = [612, 792]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return doc.save();
}
```

- [ ] **Step 2: Write the failing service tests**

`src/server/envelopes/service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject, objectExists } from "@/server/storage/storage";
import { withTenant } from "@/server/db/tenant";
import { listAudit } from "@/server/audit/service";
import {
  createEnvelope, createUploadUrl, finalizeUpload, getEnvelope, listEnvelopes, countByStatus,
  deleteDraft, voidEnvelope, uploadKeyFor,
} from "./service";

const admin = migratorSql();
let tenantId: string, otherTenant: string, userId: string;

beforeAll(async () => {
  const u = await insertUser(admin);
  userId = u.id;
  ({ id: tenantId } = await createTenant({ userId, name: "Env Co" }));
  ({ id: otherTenant } = await createTenant({ userId, name: "Other Co" }));
});
afterAll(async () => {
  await admin.end();
});

async function uploaded(pages = 2) {
  const { id } = await createEnvelope({ tenantId, userId, title: "NDA" });
  const key = uploadKeyFor(tenantId, id);
  await putObject(key, await makePdf(pages), "application/pdf");
  return { id, key };
}

describe("envelope drafts", () => {
  it("creates a draft and logs 'created'", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "  Lease  " });
    const { envelope } = await getEnvelope(tenantId, id);
    expect(envelope).toMatchObject({ title: "Lease", status: "draft" });
    const events = await withTenant(tenantId, (tx) => listAudit(tx, id));
    expect(events.map((e) => e.event)).toEqual(["created"]);
  });

  it("rejects an empty title", async () => {
    await expect(createEnvelope({ tenantId, userId, title: "   " })).rejects.toThrow(/title/i);
  });

  it("presigns an upload scoped to the envelope", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "T" });
    const { key, url } = await createUploadUrl({ tenantId, envelopeId: id });
    expect(key.startsWith(`t/${tenantId}/e/${id}/`)).toBe(true);
    expect(url).toContain(key);
  });

  it("finalizes a real PDF: page count, sizes, hash, audit", async () => {
    const { id, key } = await uploaded(3);
    const res = await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "nda.pdf" });
    expect(res.pageCount).toBe(3);
    const { document } = await getEnvelope(tenantId, id);
    expect(document).toMatchObject({ filename: "nda.pdf", pageCount: 3, pageSizes: [{ w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 }] });
    expect(document!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const events = await withTenant(tenantId, (tx) => listAudit(tx, id));
    expect(events.map((e) => e.event)).toContain("document_uploaded");
  });

  it("replaces the document when uploading again", async () => {
    const { id, key } = await uploaded(1);
    await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "a.pdf" });
    const key2 = uploadKeyFor(tenantId, id);
    await putObject(key2, await makePdf(4), "application/pdf");
    await finalizeUpload({ tenantId, userId, envelopeId: id, key: key2, filename: "b.pdf" });
    expect((await getEnvelope(tenantId, id)).document).toMatchObject({ filename: "b.pdf", pageCount: 4 });
  });

  it("rejects a file over 25 MB and deletes it", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Huge" });
    const key = uploadKeyFor(tenantId, id);
    const big = new Uint8Array(26_214_401);
    big.set(new TextEncoder().encode("%PDF-"));
    await putObject(key, big, "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "big.pdf" })).rejects.toThrow(/25 MB/);
    expect(await objectExists(key)).toBe(false);
  });

  it("gives a clear error when the upload never reached storage", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Ghost" });
    await expect(
      finalizeUpload({ tenantId, userId, envelopeId: id, key: uploadKeyFor(tenantId, id), filename: "g.pdf" }),
    ).rejects.toThrow(/did not finish/);
  });

  it("rejects bytes that are not a PDF, leaving no document", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Bad" });
    const key = uploadKeyFor(tenantId, id);
    await putObject(key, new TextEncoder().encode("hello, I am a text file"), "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "x.pdf" })).rejects.toThrow(/not a valid PDF/);
    expect((await getEnvelope(tenantId, id)).document).toBeNull();
  });

  it("rejects a truncated PDF", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Trunc" });
    const key = uploadKeyFor(tenantId, id);
    const pdf = await makePdf(2);
    await putObject(key, pdf.slice(0, 40), "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "t.pdf" })).rejects.toThrow(/not a valid PDF/);
  });

  it("rejects an upload key for another envelope or workspace", async () => {
    const a = await uploaded(1);
    const { id: b } = await createEnvelope({ tenantId, userId, title: "B" });
    await expect(finalizeUpload({ tenantId, userId, envelopeId: b, key: a.key, filename: "x.pdf" })).rejects.toThrow(/upload/i);
    const foreign = `t/${otherTenant}/e/${a.id}/${randomUUID()}.pdf`;
    await expect(finalizeUpload({ tenantId, userId, envelopeId: a.id, key: foreign, filename: "x.pdf" })).rejects.toThrow(/upload/i);
  });

  it("cannot read another workspace's envelope", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Private" });
    await expect(getEnvelope(otherTenant, id)).rejects.toThrow(/not found/i);
  });

  it("lists envelopes with status filter and counts", async () => {
    const { id } = await createEnvelope({ tenantId: otherTenant, userId, title: "Listed" });
    const all = await listEnvelopes(otherTenant);
    expect(all.find((e) => e.id === id)).toMatchObject({ title: "Listed", status: "draft", recipientCount: 0, signedCount: 0 });
    expect(await listEnvelopes(otherTenant, { status: "sent" })).toHaveLength(0);
    expect((await countByStatus(otherTenant)).draft).toBeGreaterThanOrEqual(1);
  });

  it("deletes drafts but refuses to void a draft", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Gone" });
    await expect(voidEnvelope({ tenantId, userId, envelopeId: id, reason: "x" })).rejects.toThrow(/only sent/i);
    await deleteDraft({ tenantId, envelopeId: id });
    await expect(getEnvelope(tenantId, id)).rejects.toThrow(/not found/i);
  });
});
```

Run: `npx vitest run src/server/envelopes/service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Keys and PDF inspection**

`src/server/envelopes/keys.ts`:
```ts
import { randomUUID } from "node:crypto";

export function uploadKeyFor(tenantId: string, envelopeId: string): string {
  return `t/${tenantId}/e/${envelopeId}/${randomUUID()}.pdf`;
}

const KEY_RE = /^t\/([0-9a-f-]{36})\/e\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.pdf$/;

export function isUploadKeyFor(key: string, tenantId: string, envelopeId: string): boolean {
  const m = KEY_RE.exec(key);
  return !!m && m[1] === tenantId && m[2] === envelopeId;
}
```

`src/server/envelopes/pdf.ts`:
```ts
import "server-only";
import { PDFDocument, EncryptedPDFError } from "pdf-lib";
import type { PageSize } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";

export const MAX_PAGES = 200;

export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number; pageSizes: PageSize[] }> {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new ValidationError("This file is not a valid PDF");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError) throw new ValidationError("Password-protected PDFs are not supported");
    throw new ValidationError("This file is not a valid PDF");
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new ValidationError("This file is not a valid PDF (no pages)");
  if (pages.length > MAX_PAGES) throw new ValidationError(`PDFs can have at most ${MAX_PAGES} pages`);
  return { pageCount: pages.length, pageSizes: pages.map((p) => ({ w: p.getWidth(), h: p.getHeight() })) };
}
```
If pdf-lib parses a truncated file without throwing (it is lenient), the truncated test will fail; then also require `%%EOF` within the last 1024 bytes before loading:
```ts
  const tail = new TextDecoder().decode(bytes.slice(-1024));
  if (!tail.includes("%%EOF")) throw new ValidationError("This file is not a valid PDF");
```

- [ ] **Step 4: Envelope service**

`src/server/envelopes/service.ts`:
```ts
import "server-only";
import { createHash } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/server/db/tenant";
import { documents, envelopes, fields, recipients, type EnvelopeStatus } from "@/server/db/schema";
import { appendAudit } from "@/server/audit/service";
import { deleteObject, getObjectBytes, objectExists, presignUpload } from "@/server/storage/storage";
import { InvalidStateError, NotFoundError, ValidationError } from "@/server/errors";
import { inspectPdf } from "./pdf";
import { isUploadKeyFor, uploadKeyFor } from "./keys";

export { uploadKeyFor } from "./keys";
export const MAX_UPLOAD_BYTES = 26_214_400;

export async function lockEnvelope(tx: Tx, envelopeId: string) {
  const [env] = await tx.select().from(envelopes).where(eq(envelopes.id, envelopeId)).for("update");
  if (!env) throw new NotFoundError("Envelope not found");
  return env;
}

export async function lockDraft(tx: Tx, envelopeId: string) {
  const env = await lockEnvelope(tx, envelopeId);
  if (env.status !== "draft") throw new InvalidStateError("This envelope was already sent and can no longer be edited");
  return env;
}

function cleanTitle(raw: string) {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 1 || t.length > 200) throw new ValidationError("Title must be between 1 and 200 characters");
  return t;
}

export async function createEnvelope(i: { tenantId: string; userId: string; title: string }) {
  const title = cleanTitle(i.title);
  return withTenant(i.tenantId, async (tx) => {
    const [row] = await tx.insert(envelopes).values({ tenantId: i.tenantId, createdBy: i.userId, title }).returning({ id: envelopes.id });
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: row.id, actorType: "user", actorId: i.userId, event: "created", data: { title } });
    return { id: row.id };
  });
}

export async function createUploadUrl(i: { tenantId: string; envelopeId: string }) {
  await withTenant(i.tenantId, (tx) => lockDraft(tx, i.envelopeId));
  const key = uploadKeyFor(i.tenantId, i.envelopeId);
  return { url: await presignUpload(key, "application/pdf"), key };
}

export async function finalizeUpload(i: { tenantId: string; userId: string; envelopeId: string; key: string; filename: string }) {
  if (!isUploadKeyFor(i.key, i.tenantId, i.envelopeId)) throw new ValidationError("This upload does not belong to this envelope");
  if (!(await objectExists(i.key))) throw new ValidationError("The upload did not finish. Please try again.");
  const bytes = await getObjectBytes(i.key);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    await deleteObject(i.key);
    throw new ValidationError("PDFs can be at most 25 MB");
  }
  let info: Awaited<ReturnType<typeof inspectPdf>>;
  try {
    info = await inspectPdf(bytes);
  } catch (e) {
    await deleteObject(i.key);
    throw e;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = i.filename.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "document.pdf";
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const [old] = await tx.select().from(documents).where(eq(documents.envelopeId, i.envelopeId));
    if (old) await tx.delete(documents).where(eq(documents.id, old.id)); // fields cascade
    const [doc] = await tx
      .insert(documents)
      .values({ tenantId: i.tenantId, envelopeId: i.envelopeId, filename, s3Key: i.key, sha256, pageCount: info.pageCount, pageSizes: info.pageSizes, sizeBytes: bytes.byteLength })
      .returning({ id: documents.id });
    await appendAudit(tx, {
      tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId,
      event: "document_uploaded", data: { filename, sha256, pageCount: info.pageCount },
    });
    return { documentId: doc.id, pageCount: info.pageCount, oldKey: old?.s3Key ?? null };
  }).then(async (r) => {
    if (r.oldKey) await deleteObject(r.oldKey);
    return { documentId: r.documentId, pageCount: r.pageCount };
  });
}

export async function getEnvelope(tenantId: string, envelopeId: string) {
  return withTenant(tenantId, async (tx) => {
    const [envelope] = await tx.select().from(envelopes).where(eq(envelopes.id, envelopeId));
    if (!envelope) throw new NotFoundError("Envelope not found");
    const [document] = await tx.select().from(documents).where(eq(documents.envelopeId, envelopeId));
    const recs = await tx.select().from(recipients).where(eq(recipients.envelopeId, envelopeId)).orderBy(recipients.routingOrder, recipients.createdAt);
    const flds = await tx.select().from(fields).where(eq(fields.envelopeId, envelopeId)).orderBy(fields.page, fields.y);
    return { envelope, document: document ?? null, recipients: recs, fields: flds };
  });
}

export async function listEnvelopes(tenantId: string, filter: { status?: EnvelopeStatus } = {}) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: envelopes.id,
        title: envelopes.title,
        status: envelopes.status,
        createdAt: envelopes.createdAt,
        sentAt: envelopes.sentAt,
        recipientCount: sql<number>`(select count(*)::int from recipients r where r.envelope_id = ${envelopes.id} and r.role = 'signer')`,
        signedCount: sql<number>`(select count(*)::int from recipients r where r.envelope_id = ${envelopes.id} and r.status = 'signed')`,
      })
      .from(envelopes)
      .where(filter.status ? eq(envelopes.status, filter.status) : undefined)
      .orderBy(desc(envelopes.createdAt))
      .limit(200),
  );
}

export async function countByStatus(tenantId: string): Promise<Record<EnvelopeStatus, number>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select({ status: envelopes.status, n: count() }).from(envelopes).groupBy(envelopes.status),
  );
  const out = { draft: 0, sent: 0, completed: 0, declined: 0, voided: 0, expired: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function deleteDraft(i: { tenantId: string; envelopeId: string }) {
  const key = await withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const [doc] = await tx.select({ key: documents.s3Key }).from(documents).where(eq(documents.envelopeId, i.envelopeId));
    await tx.delete(envelopes).where(eq(envelopes.id, i.envelopeId));
    return doc?.key ?? null;
  });
  if (key) await deleteObject(key);
}

export async function voidEnvelope(i: { tenantId: string; userId: string; envelopeId: string; reason: string }) {
  const reason = i.reason.trim().slice(0, 500);
  if (!reason) throw new ValidationError("Give a reason for voiding");
  await withTenant(i.tenantId, async (tx) => {
    const env = await lockEnvelope(tx, i.envelopeId);
    if (env.status !== "sent") throw new InvalidStateError("Only sent envelopes can be voided");
    await tx.update(envelopes).set({ status: "voided", voidedAt: new Date(), voidReason: reason }).where(and(eq(envelopes.id, i.envelopeId)));
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId, event: "voided", data: { reason } });
  });
}
```
Note on `deleteDraft`: the audit rows cascade with the envelope. That is intended for drafts only (nothing was sent to anyone); sent envelopes cannot be deleted.

Run: `npx vitest run src/server/envelopes/service.test.ts`
Expected: 13 PASS. (The void-of-a-sent-envelope path is tested in Task 6.)

- [ ] **Step 5: Commit**

```bash
npm test
git add -A
git commit -m "feat: envelope drafts with verified PDF upload"
```

---

### Task 5: Recipients and fields

**Files:**
- Create: `src/lib/fields/geometry.ts`, `src/lib/fields/geometry.test.ts`, `src/server/envelopes/recipients.ts`, `src/server/envelopes/fields.ts`, `src/server/envelopes/editing.test.ts`

**Interfaces:**
- Consumes: `lockDraft`, `createEnvelope`, `finalizeUpload`, `getEnvelope`, `uploadKeyFor` (Task 4), `normalizeEmail` (Plan 1), `appendAudit`.
- Produces:
  - `type Box = { x: number; y: number; w: number; h: number }`
  - `isValidBox(b: Box): boolean`, `clampBox(b: Box): Box`, `toPixels(b: Box, pageW: number, pageH: number)`, `fromPixels(px: {left; top; width; height}, pageW, pageH): Box`
  - `DEFAULT_FIELD_SIZE: Record<FieldType, { w: number; h: number }>` (fractions of a Letter page)
  - `MAX_RECIPIENTS = 20`
  - `type RecipientInput = { name: string; email: string; role: "signer" | "cc"; routingOrder: number }`
  - `setRecipients(i: { tenantId; userId; envelopeId; recipients: RecipientInput[] }): Promise<{ id: string; email: string }[]>` (upserts by email, keeps ids stable, removes missing)
  - `type FieldInput = { recipientId: string; type: FieldType; page: number; x; y; w; h: number; required?: boolean }`
  - `saveFields(i: { tenantId; userId; envelopeId; fields: FieldInput[] }): Promise<number>` (replaces all fields; returns count)

- [ ] **Step 1: Write the failing geometry test**

`src/lib/fields/geometry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isValidBox, clampBox, toPixels, fromPixels } from "./geometry";

describe("field geometry", () => {
  it("accepts boxes inside the page and rejects ones outside", () => {
    expect(isValidBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.05 })).toBe(true);
    expect(isValidBox({ x: 0.9, y: 0.1, w: 0.2, h: 0.05 })).toBe(false);
    expect(isValidBox({ x: -0.01, y: 0.1, w: 0.2, h: 0.05 })).toBe(false);
    expect(isValidBox({ x: 0.1, y: 0.1, w: 0, h: 0.05 })).toBe(false);
    expect(isValidBox({ x: Number.NaN, y: 0, w: 0.1, h: 0.1 })).toBe(false);
  });

  it("clamps a box back onto the page keeping its size", () => {
    expect(clampBox({ x: 0.95, y: -0.1, w: 0.2, h: 0.1 })).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.1 });
  });

  it("converts between pixels and fractions", () => {
    const b = fromPixels({ left: 100, top: 50, width: 200, height: 40 }, 1000, 500);
    expect(b).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.08 });
    expect(toPixels(b, 1000, 500)).toEqual({ left: 100, top: 50, width: 200, height: 40 });
  });
});
```

Run: `npx vitest run src/lib/fields`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement geometry**

`src/lib/fields/geometry.ts`:
```ts
export type Box = { x: number; y: number; w: number; h: number };
export type FieldKind = "signature" | "initials" | "date" | "text" | "checkbox";

// Default sizes as fractions of a US Letter page.
export const DEFAULT_FIELD_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.28, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.18, h: 0.035 },
  text: { w: 0.25, h: 0.035 },
  checkbox: { w: 0.03, h: 0.023 },
};

const EPS = 1e-9;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function isValidBox(b: Box): boolean {
  const nums = [b.x, b.y, b.w, b.h];
  if (!nums.every(Number.isFinite)) return false;
  return b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1 + EPS && b.y + b.h <= 1 + EPS;
}

export function clampBox(b: Box): Box {
  const w = Math.min(Math.max(b.w, 0.01), 1);
  const h = Math.min(Math.max(b.h, 0.01), 1);
  return { x: round(Math.min(Math.max(b.x, 0), 1 - w)), y: round(Math.min(Math.max(b.y, 0), 1 - h)), w: round(w), h: round(h) };
}

export function toPixels(b: Box, pageW: number, pageH: number) {
  return { left: round(b.x * pageW), top: round(b.y * pageH), width: round(b.w * pageW), height: round(b.h * pageH) };
}

export function fromPixels(px: { left: number; top: number; width: number; height: number }, pageW: number, pageH: number): Box {
  return { x: round(px.left / pageW), y: round(px.top / pageH), w: round(px.width / pageW), h: round(px.height / pageH) };
}
```

Run: `npx vitest run src/lib/fields`
Expected: 3 PASS.

- [ ] **Step 3: Write the failing editing tests**

`src/server/envelopes/editing.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject } from "@/server/storage/storage";
import { createEnvelope, finalizeUpload, getEnvelope, uploadKeyFor } from "./service";
import { setRecipients } from "./recipients";
import { saveFields } from "./fields";

const admin = migratorSql();
let tenantId: string, userId: string;

beforeAll(async () => {
  userId = (await insertUser(admin)).id;
  ({ id: tenantId } = await createTenant({ userId, name: "Edit Co" }));
});
afterAll(async () => {
  await admin.end();
});

async function draftWithPdf(pages = 2) {
  const { id } = await createEnvelope({ tenantId, userId, title: "Doc" });
  const key = uploadKeyFor(tenantId, id);
  await putObject(key, await makePdf(pages), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "d.pdf" });
  return id;
}

const alice = { name: "Alice", email: "Alice@Example.com ", role: "signer" as const, routingOrder: 1 };
const bob = { name: "Bob", email: "bob@example.com", role: "signer" as const, routingOrder: 2 };

describe("recipients", () => {
  it("saves recipients with normalized emails and keeps ids stable on re-save", async () => {
    const id = await draftWithPdf();
    const first = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice, bob] });
    expect(first.map((r) => r.email)).toEqual(["alice@example.com", "bob@example.com"]);
    const second = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, name: "Alice B" }] });
    expect(second[0].id).toBe(first[0].id);
    expect((await getEnvelope(tenantId, id)).recipients.map((r) => r.name)).toEqual(["Alice B"]);
  });

  it("rejects duplicate emails (case-insensitive)", async () => {
    const id = await draftWithPdf();
    await expect(
      setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice, { ...bob, email: "ALICE@example.com" }] }),
    ).rejects.toThrow(/more than once/);
  });

  it("rejects bad input: no name, bad email, bad order, too many", async () => {
    const id = await draftWithPdf();
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, name: " " }] })).rejects.toThrow(/name/i);
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, email: "nope" }] })).rejects.toThrow(/valid email/);
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, routingOrder: 0 }] })).rejects.toThrow(/order/i);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...alice, email: `p${i}@x.dev` }));
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: many })).rejects.toThrow(/20/);
  });
});

describe("fields", () => {
  it("replaces fields and validates them", async () => {
    const id = await draftWithPdf(2);
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    const n = await saveFields({ tenantId, userId, envelopeId: id, fields: [
      { recipientId: a.id, type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
      { recipientId: a.id, type: "date", page: 2, x: 0.5, y: 0.8, w: 0.2, h: 0.03 },
    ] });
    expect(n).toBe(2);
    await saveFields({ tenantId, userId, envelopeId: id, fields: [{ recipientId: a.id, type: "text", page: 1, x: 0, y: 0, w: 0.2, h: 0.03 }] });
    expect((await getEnvelope(tenantId, id)).fields.map((f) => f.type)).toEqual(["text"]);
  });

  it("rejects a field off the page or on a missing page", async () => {
    const id = await draftWithPdf(2);
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    await expect(
      saveFields({ tenantId, userId, envelopeId: id, fields: [{ recipientId: a.id, type: "signature", page: 1, x: 0.9, y: 0.8, w: 0.3, h: 0.06 }] }),
    ).rejects.toThrow(/outside the page/);
    await expect(
      saveFields({ tenantId, userId, envelopeId: id, fields: [{ recipientId: a.id, type: "signature", page: 3, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] }),
    ).rejects.toThrow(/page 3/);
  });

  it("rejects a field for a recipient of another envelope, or for a cc", async () => {
    const id1 = await draftWithPdf(1);
    const id2 = await draftWithPdf(1);
    const [other] = await setRecipients({ tenantId, userId, envelopeId: id2, recipients: [alice] });
    await expect(
      saveFields({ tenantId, userId, envelopeId: id1, fields: [{ recipientId: other.id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] }),
    ).rejects.toThrow(/recipient/i);
    const [cc] = await setRecipients({ tenantId, userId, envelopeId: id1, recipients: [{ ...bob, role: "cc" }] });
    await expect(
      saveFields({ tenantId, userId, envelopeId: id1, fields: [{ recipientId: cc.id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] }),
    ).rejects.toThrow(/cc/i);
  });

  it("requires a document before fields can be placed", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "No doc" });
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    await expect(
      saveFields({ tenantId, userId, envelopeId: id, fields: [{ recipientId: a.id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] }),
    ).rejects.toThrow(/upload a PDF/i);
  });

  it("rejects edits after the envelope is sent", async () => {
    const id = await draftWithPdf(1);
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    await admin`update envelopes set status = 'sent' where id = ${id}`;
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] })).rejects.toThrow(/already sent/);
    await expect(
      saveFields({ tenantId, userId, envelopeId: id, fields: [{ recipientId: a.id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] }),
    ).rejects.toThrow(/already sent/);
  });
});
```

Run: `npx vitest run src/server/envelopes/editing.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement recipients**

`src/server/envelopes/recipients.ts`:
```ts
import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { withTenant } from "@/server/db/tenant";
import { recipients } from "@/server/db/schema";
import { appendAudit } from "@/server/audit/service";
import { normalizeEmail } from "@/server/team/email";
import { ValidationError } from "@/server/errors";
import { lockDraft } from "./service";

export const MAX_RECIPIENTS = 20;
export type RecipientInput = { name: string; email: string; role: "signer" | "cc"; routingOrder: number };

function clean(list: RecipientInput[]) {
  if (list.length > MAX_RECIPIENTS) throw new ValidationError(`An envelope can have at most ${MAX_RECIPIENTS} recipients`);
  const seen = new Set<string>();
  return list.map((r) => {
    const name = r.name.trim().replace(/\s+/g, " ");
    if (name.length < 1 || name.length > 120) throw new ValidationError("Every recipient needs a name");
    const email = normalizeEmail(r.email);
    if (seen.has(email)) throw new ValidationError(`${email} is listed more than once`);
    seen.add(email);
    if (!Number.isInteger(r.routingOrder) || r.routingOrder < 1 || r.routingOrder > MAX_RECIPIENTS) {
      throw new ValidationError("Signing order must be a number from 1 to 20");
    }
    if (r.role !== "signer" && r.role !== "cc") throw new ValidationError("Role must be signer or cc");
    return { name, email, role: r.role, routingOrder: r.routingOrder };
  });
}

export async function setRecipients(i: { tenantId: string; userId: string; envelopeId: string; recipients: RecipientInput[] }) {
  const list = clean(i.recipients);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const emails = list.map((r) => r.email);
    // Removing a recipient also removes their fields (cascade).
    await tx
      .delete(recipients)
      .where(emails.length ? and(eq(recipients.envelopeId, i.envelopeId), notInArray(recipients.email, emails)) : eq(recipients.envelopeId, i.envelopeId));
    const out: { id: string; email: string }[] = [];
    for (const r of list) {
      const [row] = await tx
        .insert(recipients)
        .values({ tenantId: i.tenantId, envelopeId: i.envelopeId, ...r })
        .onConflictDoUpdate({ target: [recipients.envelopeId, recipients.email], set: { name: r.name, role: r.role, routingOrder: r.routingOrder } })
        .returning({ id: recipients.id, email: recipients.email });
      out.push(row);
    }
    await appendAudit(tx, {
      tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId,
      event: "recipients_updated", data: { recipients: list.map((r) => ({ email: r.email, role: r.role, order: r.routingOrder })) },
    });
    return out;
  });
}
```

- [ ] **Step 5: Implement fields**

`src/server/envelopes/fields.ts`:
```ts
import "server-only";
import { eq } from "drizzle-orm";
import { withTenant } from "@/server/db/tenant";
import { documents, fields, recipients, type FieldType } from "@/server/db/schema";
import { appendAudit } from "@/server/audit/service";
import { ValidationError } from "@/server/errors";
import { isValidBox } from "@/lib/fields/geometry";
import { lockDraft } from "./service";

export const MAX_FIELDS = 500;
const TYPES: FieldType[] = ["signature", "initials", "date", "text", "checkbox"];
export type FieldInput = { recipientId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required?: boolean };

export async function saveFields(i: { tenantId: string; userId: string; envelopeId: string; fields: FieldInput[] }) {
  if (i.fields.length > MAX_FIELDS) throw new ValidationError(`At most ${MAX_FIELDS} fields per envelope`);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const [doc] = await tx.select().from(documents).where(eq(documents.envelopeId, i.envelopeId));
    if (!doc) throw new ValidationError("Upload a PDF before placing fields");
    const recs = new Map((await tx.select().from(recipients).where(eq(recipients.envelopeId, i.envelopeId))).map((r) => [r.id, r]));
    const rows = i.fields.map((f) => {
      if (!TYPES.includes(f.type)) throw new ValidationError(`Unknown field type ${f.type}`);
      const rec = recs.get(f.recipientId);
      if (!rec) throw new ValidationError("A field is assigned to a recipient who is not on this envelope");
      if (rec.role === "cc") throw new ValidationError(`${rec.email} is cc only and cannot have fields`);
      if (!Number.isInteger(f.page) || f.page < 1 || f.page > doc.pageCount) {
        throw new ValidationError(`The document has no page ${f.page}`);
      }
      if (!isValidBox(f)) throw new ValidationError("A field is outside the page");
      return {
        tenantId: i.tenantId, envelopeId: i.envelopeId, documentId: doc.id, recipientId: f.recipientId,
        type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required ?? f.type !== "checkbox",
      };
    });
    await tx.delete(fields).where(eq(fields.envelopeId, i.envelopeId));
    if (rows.length) await tx.insert(fields).values(rows);
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId, event: "fields_updated", data: { count: rows.length } });
    return rows.length;
  });
}
```

Run: `npx vitest run src/server/envelopes src/lib/fields`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
npm test
git add -A
git commit -m "feat: envelope recipients and field placement with server-side validation"
```

---

### Task 6: Sending and voiding

**Files:**
- Create: `src/server/envelopes/send.ts`, `src/server/envelopes/send.test.ts`

**Interfaces:**
- Consumes: `lockDraft`, `lockEnvelope`, `voidEnvelope`, `getEnvelope` (Task 4), `setRecipients` (Task 5), `saveFields` (Task 5), `hashToken` (Plan 1 team service), `env.BETTER_AUTH_URL`, `appendAudit`.
- Produces:
  - `type SendOptions = { expiresInDays: number; reminderEveryDays: number | null; message?: string | null }`
  - `sendEnvelope(i: { tenantId; userId; envelopeId } & SendOptions): Promise<{ recipientId: string; email: string; name: string; routingOrder: number; url: string }[]>`
  - `signingUrl(token: string): string`

- [ ] **Step 1: Write the failing tests**

`src/server/envelopes/send.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject } from "@/server/storage/storage";
import { withTenant } from "@/server/db/tenant";
import { listAudit, verifyChain } from "@/server/audit/service";
import { hashToken } from "@/server/team/service";
import { createEnvelope, finalizeUpload, getEnvelope, uploadKeyFor, voidEnvelope } from "./service";
import { setRecipients } from "./recipients";
import { saveFields } from "./fields";
import { sendEnvelope } from "./send";

const admin = migratorSql();
let tenantId: string, userId: string;
const opts = { expiresInDays: 30, reminderEveryDays: 3 };

beforeAll(async () => {
  userId = (await insertUser(admin)).id;
  ({ id: tenantId } = await createTenant({ userId, name: "Send Co" }));
});
afterAll(async () => {
  await admin.end();
});

async function ready({ withFields = true } = {}) {
  const { id } = await createEnvelope({ tenantId, userId, title: "Contract" });
  const key = uploadKeyFor(tenantId, id);
  await putObject(key, await makePdf(1), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "c.pdf" });
  const recs = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [
    { name: "A", email: "a@x.dev", role: "signer", routingOrder: 1 },
    { name: "B", email: "b@x.dev", role: "signer", routingOrder: 2 },
    { name: "C", email: "c@x.dev", role: "cc", routingOrder: 1 },
  ] });
  if (withFields) {
    await saveFields({ tenantId, userId, envelopeId: id, fields: [
      { recipientId: recs[0].id, type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
      { recipientId: recs[1].id, type: "signature", page: 1, x: 0.5, y: 0.8, w: 0.3, h: 0.06 },
    ] });
  }
  return id;
}

describe("sendEnvelope", () => {
  it("sends: status, expiry, first routing step, hashed tokens, audit", async () => {
    const id = await ready();
    const links = await sendEnvelope({ tenantId, userId, envelopeId: id, ...opts });
    expect(links.map((l) => l.email).sort()).toEqual(["a@x.dev", "b@x.dev", "c@x.dev"]);
    const { envelope, recipients } = await getEnvelope(tenantId, id);
    expect(envelope.status).toBe("sent");
    expect(envelope.expiresAt!.getTime() - envelope.sentAt!.getTime()).toBeCloseTo(30 * 86_400_000, -4);
    const status = Object.fromEntries(recipients.map((r) => [r.email, r.status]));
    expect(status).toEqual({ "a@x.dev": "sent", "b@x.dev": "pending", "c@x.dev": "pending" });
    const a = links.find((l) => l.email === "a@x.dev")!;
    const token = a.url.split("/sign/")[1];
    expect(recipients.find((r) => r.email === "a@x.dev")!.tokenHash).toBe(hashToken(token));
    const events = await withTenant(tenantId, (tx) => listAudit(tx, id));
    expect(events.at(-1)!.event).toBe("sent");
    expect((await withTenant(tenantId, (tx) => verifyChain(tx, id))).ok).toBe(true);
  });

  it("sends only once when clicked twice at the same time", async () => {
    const id = await ready();
    const results = await Promise.allSettled([
      sendEnvelope({ tenantId, userId, envelopeId: id, ...opts }),
      sendEnvelope({ tenantId, userId, envelopeId: id, ...opts }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/already sent/);
  });

  it("refuses to send without a document, signers, or a signature field per signer", async () => {
    const { id: noDoc } = await createEnvelope({ tenantId, userId, title: "Empty" });
    await expect(sendEnvelope({ tenantId, userId, envelopeId: noDoc, ...opts })).rejects.toThrow(/upload a PDF/i);
    const noFields = await ready({ withFields: false });
    await expect(sendEnvelope({ tenantId, userId, envelopeId: noFields, ...opts })).rejects.toThrow(/a@x.dev.*signature/);
  });

  it("validates expiry and reminder options", async () => {
    const id = await ready();
    await expect(sendEnvelope({ tenantId, userId, envelopeId: id, expiresInDays: 0, reminderEveryDays: null })).rejects.toThrow(/expire/i);
    await expect(sendEnvelope({ tenantId, userId, envelopeId: id, expiresInDays: 30, reminderEveryDays: 31 })).rejects.toThrow(/remind/i);
  });

  it("can void a sent envelope, not twice", async () => {
    const id = await ready();
    await sendEnvelope({ tenantId, userId, envelopeId: id, ...opts });
    await voidEnvelope({ tenantId, userId, envelopeId: id, reason: "Wrong terms" });
    expect((await getEnvelope(tenantId, id)).envelope).toMatchObject({ status: "voided", voidReason: "Wrong terms" });
    await expect(voidEnvelope({ tenantId, userId, envelopeId: id, reason: "again" })).rejects.toThrow(/only sent/i);
  });
});
```

Run: `npx vitest run src/server/envelopes/send.test.ts`
Expected: FAIL, cannot find `./send`.

- [ ] **Step 2: Implement send**

`src/server/envelopes/send.ts`:
```ts
import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/server/db/tenant";
import { documents, envelopes, fields, recipients } from "@/server/db/schema";
import { appendAudit } from "@/server/audit/service";
import { hashToken } from "@/server/team/service";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { lockDraft } from "./service";

export type SendOptions = { expiresInDays: number; reminderEveryDays: number | null; message?: string | null };

export function signingUrl(token: string) {
  return `${env.BETTER_AUTH_URL}/sign/${token}`;
}

function checkOptions(o: SendOptions) {
  if (!Number.isInteger(o.expiresInDays) || o.expiresInDays < 1 || o.expiresInDays > 365) {
    throw new ValidationError("Envelopes must expire in 1 to 365 days");
  }
  if (o.reminderEveryDays !== null && (!Number.isInteger(o.reminderEveryDays) || o.reminderEveryDays < 1 || o.reminderEveryDays > 30)) {
    throw new ValidationError("Reminders must be every 1 to 30 days, or off");
  }
  const message = o.message?.trim().slice(0, 2000) || null;
  return { ...o, message };
}

export async function sendEnvelope(i: { tenantId: string; userId: string; envelopeId: string } & SendOptions) {
  const o = checkOptions(i);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId); // second concurrent send waits here, then sees "sent"
    const [doc] = await tx.select().from(documents).where(eq(documents.envelopeId, i.envelopeId));
    if (!doc) throw new ValidationError("Upload a PDF before sending");
    const recs = await tx.select().from(recipients).where(eq(recipients.envelopeId, i.envelopeId));
    const signers = recs.filter((r) => r.role === "signer");
    if (signers.length === 0) throw new ValidationError("Add at least one signer");
    const flds = await tx.select().from(fields).where(eq(fields.envelopeId, i.envelopeId));
    for (const s of signers) {
      if (!flds.some((f) => f.recipientId === s.id && f.type === "signature")) {
        throw new ValidationError(`${s.email} needs at least one signature field`);
      }
    }
    const firstStep = Math.min(...signers.map((s) => s.routingOrder));
    const now = new Date();
    const links = [];
    for (const r of recs) {
      const token = randomBytes(32).toString("base64url");
      const isFirst = r.role === "signer" && r.routingOrder === firstStep;
      await tx.update(recipients).set({ tokenHash: hashToken(token), status: isFirst ? "sent" : "pending" }).where(eq(recipients.id, r.id));
      links.push({ recipientId: r.id, email: r.email, name: r.name, routingOrder: r.routingOrder, url: signingUrl(token) });
    }
    await tx
      .update(envelopes)
      .set({ status: "sent", sentAt: now, expiresAt: new Date(now.getTime() + o.expiresInDays * 86_400_000), reminderEveryDays: o.reminderEveryDays, message: o.message })
      .where(eq(envelopes.id, i.envelopeId));
    await appendAudit(tx, {
      tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId, event: "sent",
      data: { documentSha256: doc.sha256, signers: signers.length, expiresInDays: o.expiresInDays, reminderEveryDays: o.reminderEveryDays },
    });
    return links;
  });
}
```
Note: cc recipients get a token now so Plan 3/4 can send them the final PDF link; they stay `pending` until completion.

Run: `npx vitest run src/server/envelopes`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
npm test
git add -A
git commit -m "feat: send and void envelopes with routing, hashed signer tokens and audit"
```

---

### Task 7: Envelope pages: list, create + upload, detail, send

**Files:**
- Create: `src/components/app/status-pill.tsx`, `src/app/api/uploads/presign/route.ts`, `src/app/(app)/envelopes/new/page.tsx`, `src/app/(app)/envelopes/new/actions.ts`, `src/app/(app)/envelopes/[id]/page.tsx`, `src/app/(app)/envelopes/[id]/actions.ts`, `src/app/(app)/envelopes/[id]/upload-form.tsx`, `src/app/(app)/envelopes/[id]/send-form.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: all Task 4-6 services; `requireTenant` (Plan 1); `presignGet`.
- Produces: routes `/dashboard?status=`, `/envelopes/new`, `/envelopes/[id]`, `POST /api/uploads/presign` (JSON `{ envelopeId }` -> `{ url, key }`); server actions `createEnvelopeAction`, `finalizeUploadAction(envelopeId, key, filename)`, `sendAction`, `voidAction`, `deleteDraftAction`.

- [ ] **Step 1: Status pill**

`src/components/app/status-pill.tsx`:
```tsx
const colors: Record<string, string> = {
  draft: "bg-paper", sent: "bg-yellow", completed: "bg-green", declined: "bg-red text-white",
  voided: "bg-ink text-paper", expired: "bg-pink", pending: "bg-paper", viewed: "bg-pink", signed: "bg-green",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`border-brutal inline-block px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${colors[status] ?? "bg-paper"}`}>{status}</span>;
}
```

- [ ] **Step 2: Dashboard list**

Replace `src/app/(app)/dashboard/page.tsx`:
```tsx
import Link from "next/link";
import { requireTenant } from "@/server/tenants/current";
import { countByStatus, listEnvelopes } from "@/server/envelopes/service";
import type { EnvelopeStatus } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/app/status-pill";

const TABS: (EnvelopeStatus | "all")[] = ["all", "draft", "sent", "completed", "declined", "voided", "expired"];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { tenant } = await requireTenant();
  const { status } = await searchParams;
  const active = (TABS as string[]).includes(status ?? "") ? (status as EnvelopeStatus | "all") : "all";
  const [rows, counts] = await Promise.all([
    listEnvelopes(tenant.tenantId, active === "all" ? {} : { status: active }),
    countByStatus(tenant.tenantId),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl">Envelopes</h1>
          <p className="mt-2 font-mono text-sm">{tenant.name}</p>
        </div>
        <Link href="/envelopes/new" className="border-brutal shadow-hard-sm bg-red px-5 py-3 font-bold uppercase text-white">New envelope</Link>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {TABS.map((t) => (
          <Link key={t} href={t === "all" ? "/dashboard" : `/dashboard?status=${t}`}
            className={`border-brutal px-3 py-1.5 font-mono text-xs font-bold uppercase ${active === t ? "bg-ink text-paper" : "bg-paper"}`}>
            {t} ({t === "all" ? total : counts[t]})
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card className="bg-yellow">
          <h2 className="font-display text-2xl">Nothing here yet.</h2>
          <p className="mt-2">Create an envelope, upload a PDF and send it for signature.</p>
        </Card>
      ) : (
        <Card className="p-0">
          <table className="w-full text-left">
            <thead className="border-b-[2.5px] border-ink font-mono text-xs uppercase">
              <tr><th className="p-4">Title</th><th className="p-4">Status</th><th className="p-4">Signed</th><th className="p-4">Created</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-ink/20 hover:bg-yellow/40">
                  <td className="p-4 font-bold"><Link href={`/envelopes/${e.id}`} className="hover:underline">{e.title}</Link></td>
                  <td className="p-4"><StatusPill status={e.status} /></td>
                  <td className="p-4 font-mono text-sm">{e.signedCount}/{e.recipientCount}</td>
                  <td className="p-4 font-mono text-sm">{e.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create envelope**

`src/app/(app)/envelopes/new/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { createEnvelope } from "@/server/envelopes/service";
import { DomainError } from "@/server/errors";

export async function createEnvelopeAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const { session, tenant } = await requireTenant();
  const title = z.string().max(500).safeParse(form.get("title"));
  if (!title.success) return { error: "Enter a title" };
  let id: string;
  try {
    ({ id } = await createEnvelope({ tenantId: tenant.tenantId, userId: session.user.id, title: title.data }));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(`/envelopes/${id}`);
}
```

`src/app/(app)/envelopes/new/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { createEnvelopeAction } from "./actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function NewEnvelopePage() {
  const [state, action, pending] = useActionState(createEnvelopeAction, {});
  return (
    <Card className="max-w-xl">
      <h1 className="font-display text-4xl">New envelope.</h1>
      <form action={action} className="mt-6 space-y-4">
        <Input label="Title" name="title" required maxLength={200} placeholder="Mutual NDA - Acme" />
        {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{state.error}</p>}
        <Button variant="primary" disabled={pending}>{pending ? "Creating..." : "Create and upload PDF"}</Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Presign route**

`src/app/api/uploads/presign/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { createUploadUrl } from "@/server/envelopes/service";
import { DomainError } from "@/server/errors";

export async function POST(req: Request) {
  const { tenant } = await requireTenant();
  const body = z.object({ envelopeId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    return NextResponse.json(await createUploadUrl({ tenantId: tenant.tenantId, envelopeId: body.data.envelopeId }));
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
```

- [ ] **Step 5: Detail actions**

`src/app/(app)/envelopes/[id]/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { deleteDraft, finalizeUpload, voidEnvelope } from "@/server/envelopes/service";
import { sendEnvelope } from "@/server/envelopes/send";
import { DomainError } from "@/server/errors";

type Links = { email: string; name: string; routingOrder: number; url: string }[];

async function guard<T>(fn: () => Promise<T>): Promise<{ error?: string; data?: T }> {
  try {
    return { data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function finalizeUploadAction(envelopeId: string, key: string, filename: string) {
  const { session, tenant } = await requireTenant();
  const p = z.object({ envelopeId: z.string().uuid(), key: z.string().max(300), filename: z.string().max(300) }).parse({ envelopeId, key, filename });
  const res = await guard(() => finalizeUpload({ tenantId: tenant.tenantId, userId: session.user.id, ...p }));
  revalidatePath(`/envelopes/${envelopeId}`);
  return { error: res.error };
}

export async function sendAction(_prev: { error?: string; links?: Links }, form: FormData): Promise<{ error?: string; links?: Links }> {
  const { session, tenant } = await requireTenant();
  const p = z
    .object({ envelopeId: z.string().uuid(), expiresInDays: z.coerce.number().int(), reminderEveryDays: z.coerce.number().int(), message: z.string().max(5000) })
    .safeParse({ envelopeId: form.get("envelopeId"), expiresInDays: form.get("expiresInDays"), reminderEveryDays: form.get("reminderEveryDays"), message: form.get("message") ?? "" });
  if (!p.success) return { error: "Check the send options" };
  const res = await guard(() =>
    sendEnvelope({
      tenantId: tenant.tenantId, userId: session.user.id, envelopeId: p.data.envelopeId,
      expiresInDays: p.data.expiresInDays, reminderEveryDays: p.data.reminderEveryDays === 0 ? null : p.data.reminderEveryDays, message: p.data.message,
    }),
  );
  revalidatePath(`/envelopes/${p.data.envelopeId}`);
  return res.error ? { error: res.error } : { links: res.data!.map(({ email, name, routingOrder, url }) => ({ email, name, routingOrder, url })) };
}

export async function voidAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const envelopeId = z.string().uuid().parse(form.get("envelopeId"));
  const res = await guard(() => voidEnvelope({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, reason: String(form.get("reason") ?? "") }));
  if (res.error) redirect(`/envelopes/${envelopeId}?error=${encodeURIComponent(res.error)}`);
  revalidatePath(`/envelopes/${envelopeId}`);
}

export async function deleteDraftAction(form: FormData) {
  const { tenant } = await requireTenant();
  const envelopeId = z.string().uuid().parse(form.get("envelopeId"));
  const res = await guard(() => deleteDraft({ tenantId: tenant.tenantId, envelopeId }));
  if (res.error) redirect(`/envelopes/${envelopeId}?error=${encodeURIComponent(res.error)}`);
  redirect("/dashboard");
}
```

- [ ] **Step 6: Upload form (browser -> S3 -> finalize)**

`src/app/(app)/envelopes/[id]/upload-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finalizeUploadAction } from "./actions";
import { Button } from "@/components/ui/button";

const MAX = 26_214_400;

export function UploadForm({ envelopeId, hasDocument }: { envelopeId: string; hasDocument: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.type && file.type !== "application/pdf") return setError("Choose a PDF file");
    if (file.size > MAX) return setError("PDFs can be at most 25 MB");
    setBusy(true);
    try {
      const pre = await fetch("/api/uploads/presign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelopeId }) });
      const body = await pre.json();
      if (!pre.ok) throw new Error(body.error ?? "Upload failed");
      const up = await fetch(body.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!up.ok) throw new Error("Upload was rejected by storage");
      const res = await finalizeUploadAction(envelopeId, body.key, file.name);
      if (res.error) throw new Error(res.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="border-brutal shadow-hard-sm block cursor-pointer bg-yellow p-6 text-center font-bold">
        {busy ? "Uploading..." : hasDocument ? "Replace PDF" : "Choose a PDF to upload"}
        <input type="file" accept="application/pdf" className="sr-only" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} data-testid="pdf-input" />
      </label>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}
    </div>
  );
}
```
MinIO allows cross-origin PUTs by default. Real S3 or R2 needs a CORS rule allowing `PUT` with header `Content-Type` from the app origin (Plan 4 deployment notes).

- [ ] **Step 7: Send form**

`src/app/(app)/envelopes/[id]/send-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { sendAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SendForm({ envelopeId }: { envelopeId: string }) {
  const [state, action, pending] = useActionState(sendAction, {});
  if (state.links) {
    return (
      <div className="border-brutal bg-green p-4">
        <p className="font-display text-2xl">Sent.</p>
        <p className="mt-1">Signing emails arrive with Plan 4. Until then, share these links:</p>
        <ul className="mt-3 space-y-2">
          {state.links.map((l) => (
            <li key={l.email}>
              <span className="font-bold">{l.name}</span> <span className="font-mono text-xs">(step {l.routingOrder})</span>
              <input readOnly value={l.url} aria-label={`Signing link for ${l.email}`} onFocus={(e) => e.currentTarget.select()} className="border-brutal mt-1 w-full bg-paper px-2 py-1 font-mono text-xs" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="envelopeId" value={envelopeId} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Expires in (days)" name="expiresInDays" type="number" min={1} max={365} defaultValue={30} required />
        <Input label="Remind every (days, 0 = off)" name="reminderEveryDays" type="number" min={0} max={30} defaultValue={3} required />
      </div>
      <label className="block">
        <span className="mb-1 block font-mono text-xs font-bold uppercase">Message to signers (optional)</span>
        <textarea name="message" maxLength={2000} rows={3} className="border-brutal w-full bg-paper p-3 outline-none focus:bg-yellow" />
      </label>
      {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{state.error}</p>}
      <Button variant="primary" disabled={pending}>{pending ? "Sending..." : "Send for signature"}</Button>
    </form>
  );
}
```

- [ ] **Step 8: Detail page**

`src/app/(app)/envelopes/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { withTenant } from "@/server/db/tenant";
import { listAudit } from "@/server/audit/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/app/status-pill";
import { UploadForm } from "./upload-form";
import { SendForm } from "./send-form";
import { deleteDraftAction, voidAction } from "./actions";

export default async function EnvelopePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { tenant } = await requireTenant();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getEnvelope(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { envelope, document, recipients, fields } = data;
  const events = await withTenant(tenant.tenantId, (tx) => listAudit(tx, id));
  const docUrl = document ? await presignGet(document.s3Key) : null;
  const isDraft = envelope.status === "draft";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="font-display text-5xl">{envelope.title}</h1>
        <StatusPill status={envelope.status} />
      </div>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-display text-2xl">Document</h2>
          {document ? (
            <p className="mb-4">
              <a href={docUrl!} target="_blank" rel="noreferrer" className="font-bold underline">{document.filename}</a>{" "}
              <span className="font-mono text-xs">({document.pageCount} pages)</span>
            </p>
          ) : <p className="mb-4">No PDF yet.</p>}
          {isDraft && <UploadForm envelopeId={id} hasDocument={!!document} />}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-2xl">Recipients</h2>
            {isDraft && document && <Link href={`/envelopes/${id}/edit`} className="border-brutal shadow-hard-sm bg-yellow px-3 py-1.5 text-sm font-bold uppercase">Edit recipients and fields</Link>}
          </div>
          {recipients.length === 0 ? <p>None yet.</p> : (
            <ul className="space-y-2">
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b border-ink/20 pb-2">
                  <span><b>{r.name}</b> <span className="font-mono text-xs">{r.email} - {r.role} - step {r.routingOrder}</span></span>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 font-mono text-xs">{fields.length} fields placed</p>
        </Card>
      </div>

      {isDraft && document && (
        <Card><h2 className="mb-4 font-display text-2xl">Send</h2><SendForm envelopeId={id} /></Card>
      )}

      <Card>
        <h2 className="mb-3 font-display text-2xl">Activity</h2>
        <ol className="space-y-1 font-mono text-xs">
          {events.map((e) => (
            <li key={e.id}><span className="font-bold uppercase">{e.event}</span> - {e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</li>
          ))}
        </ol>
      </Card>

      <div className="flex gap-3">
        {isDraft && (
          <form action={deleteDraftAction}><input type="hidden" name="envelopeId" value={id} /><Button>Delete draft</Button></form>
        )}
        {envelope.status === "sent" && (
          <form action={voidAction} className="flex gap-2">
            <input type="hidden" name="envelopeId" value={id} />
            <input name="reason" required placeholder="Reason for voiding" aria-label="Reason for voiding" className="border-brutal px-3 py-2" />
            <Button>Void envelope</Button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Verify**

Run: `npm test && npm run build`
Expected: all PASS; build succeeds.
Manual: `npm run dev`, create an envelope, upload a PDF, see page count and the "created" and "document_uploaded" activity lines.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: envelope list, create, upload, detail, send and void pages"
```

---

### Task 8: Recipients form and field editor

**Files:**
- Create: `src/app/(app)/envelopes/[id]/edit/page.tsx`, `src/app/(app)/envelopes/[id]/edit/actions.ts`, `src/app/(app)/envelopes/[id]/edit/recipients-form.tsx`, `src/app/(app)/envelopes/[id]/edit/editor.tsx`, `src/app/(app)/envelopes/[id]/edit/pdf-canvas.tsx`

**Interfaces:**
- Consumes: `getEnvelope`, `presignGet`, `setRecipients`, `saveFields`, geometry helpers (Task 5).
- Produces: route `/envelopes/[id]/edit`; actions `saveRecipientsAction(envelopeId, list)`, `saveFieldsAction(envelopeId, fields)`; editor UI contract used by e2e: palette buttons named `Signature`, `Initials`, `Date`, `Text`, `Checkbox`; page canvases with `data-testid="page-<n>"`; `Save fields` button; recipient select labelled `Assign to`.

- [ ] **Step 1: Actions**

`src/app/(app)/envelopes/[id]/edit/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { setRecipients } from "@/server/envelopes/recipients";
import { saveFields } from "@/server/envelopes/fields";
import { DomainError } from "@/server/errors";

const Recipient = z.object({ name: z.string().max(200), email: z.string().max(300), role: z.enum(["signer", "cc"]), routingOrder: z.number().int() });
const Field = z.object({
  recipientId: z.string().uuid(), type: z.enum(["signature", "initials", "date", "text", "checkbox"]),
  page: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), required: z.boolean().optional(),
});

export async function saveRecipientsAction(envelopeId: string, list: unknown) {
  const { session, tenant } = await requireTenant();
  const parsed = z.object({ envelopeId: z.string().uuid(), list: z.array(Recipient).max(50) }).safeParse({ envelopeId, list });
  if (!parsed.success) return { error: "Check the recipient details" };
  try {
    const saved = await setRecipients({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, recipients: parsed.data.list });
    revalidatePath(`/envelopes/${envelopeId}/edit`);
    return { saved };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function saveFieldsAction(envelopeId: string, list: unknown) {
  const { session, tenant } = await requireTenant();
  const parsed = z.object({ envelopeId: z.string().uuid(), list: z.array(Field).max(500) }).safeParse({ envelopeId, list });
  if (!parsed.success) return { error: "Some fields are invalid" };
  try {
    const count = await saveFields({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, fields: parsed.data.list });
    revalidatePath(`/envelopes/${envelopeId}`);
    return { count };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
```

- [ ] **Step 2: Recipients form**

`src/app/(app)/envelopes/[id]/edit/recipients-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRecipientsAction } from "./actions";
import { Button } from "@/components/ui/button";

type Row = { name: string; email: string; role: "signer" | "cc"; routingOrder: number };

export function RecipientsForm({ envelopeId, initial }: { envelopeId: string; initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [{ name: "", email: "", role: "signer", routingOrder: 1 }]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  async function save() {
    setBusy(true);
    const res = await saveRecipientsAction(envelopeId, rows);
    setBusy(false);
    if (res.error) return setMsg({ error: res.error });
    setMsg({ ok: "Recipients saved" });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_7rem_5rem_auto] items-end gap-2">
          <input aria-label={`Recipient ${i + 1} name`} placeholder="Name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} className="border-brutal px-2 py-2" />
          <input aria-label={`Recipient ${i + 1} email`} placeholder="email@company.com" type="email" value={r.email} onChange={(e) => update(i, { email: e.target.value })} className="border-brutal px-2 py-2" />
          <select aria-label={`Recipient ${i + 1} role`} value={r.role} onChange={(e) => update(i, { role: e.target.value as Row["role"] })} className="border-brutal px-2 py-2">
            <option value="signer">Signer</option><option value="cc">CC</option>
          </select>
          <input aria-label={`Recipient ${i + 1} order`} type="number" min={1} max={20} value={r.routingOrder} onChange={(e) => update(i, { routingOrder: Number(e.target.value) })} className="border-brutal px-2 py-2" />
          <button type="button" aria-label={`Remove recipient ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="border-brutal px-3 py-2 font-bold">x</button>
        </div>
      ))}
      <p className="font-mono text-xs">Same order number = sign in parallel. Lower numbers sign first.</p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => setRows((rs) => [...rs, { name: "", email: "", role: "signer", routingOrder: rs.length + 1 }])}>Add recipient</Button>
        <Button type="button" variant="accent" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save recipients"}</Button>
      </div>
      {msg.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{msg.error}</p>}
      {msg.ok && <p role="status" className="border-brutal bg-green p-2 font-bold">{msg.ok}</p>}
    </div>
  );
}
```

- [ ] **Step 3: PDF page canvas**

`src/app/(app)/envelopes/[id]/edit/pdf-canvas.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Renders one PDF page at the given CSS width.
export function PdfCanvas({ doc, pageNumber, width }: { doc: PDFDocumentProxy; pageNumber: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${(viewport.height / viewport.width) * width}px`;
      const render = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
      task = render;
      await render.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);
  return <canvas ref={ref} className="block" />;
}
```

- [ ] **Step 4: Field editor**

`src/app/(app)/envelopes/[id]/edit/editor.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfCanvas } from "./pdf-canvas";
import { saveFieldsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { clampBox, DEFAULT_FIELD_SIZE, type Box, type FieldKind } from "@/lib/fields/geometry";

type Recipient = { id: string; name: string; email: string; role: "signer" | "cc" };
type EditorField = Box & { key: string; recipientId: string; type: FieldKind; page: number };
type PageSize = { w: number; h: number };

const KINDS: { type: FieldKind; label: string }[] = [
  { type: "signature", label: "Signature" }, { type: "initials", label: "Initials" }, { type: "date", label: "Date" },
  { type: "text", label: "Text" }, { type: "checkbox", label: "Checkbox" },
];
const COLORS = ["#FFE600", "#FF8AD8", "#00D26A", "#2F5BFF", "#FF3D00"];
const PAGE_W = 760;

export function FieldEditor(props: { envelopeId: string; pdfUrl: string; pageSizes: PageSize[]; recipients: Recipient[]; initial: EditorField[] }) {
  const signers = props.recipients.filter((r) => r.role === "signer");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fields, setFields] = useState<EditorField[]>(props.initial);
  const [tool, setTool] = useState<FieldKind | null>(null);
  const [assignee, setAssignee] = useState(signers[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const drag = useRef<{ key: string; mode: "move" | "resize"; startX: number; startY: number; orig: Box; pageW: number; pageH: number } | null>(null);
  const color = (rid: string) => COLORS[Math.max(0, signers.findIndex((s) => s.id === rid)) % COLORS.length];

  useEffect(() => {
    let alive = true;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const d = await pdfjs.getDocument({ url: props.pdfUrl }).promise;
      if (alive) setDoc(d);
    })().catch(() => setMsg({ error: "Could not load the PDF preview" }));
    return () => { alive = false; };
  }, [props.pdfUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !(e.target instanceof HTMLInputElement)) {
        setFields((fs) => fs.filter((f) => f.key !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function place(e: React.MouseEvent<HTMLDivElement>, page: number) {
    if (!tool || !assignee || e.target !== e.currentTarget.firstChild) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const size = DEFAULT_FIELD_SIZE[tool];
    const box = clampBox({ x: (e.clientX - rect.left) / rect.width - size.w / 2, y: (e.clientY - rect.top) / rect.height - size.h / 2, ...size });
    const f = { ...box, key: crypto.randomUUID(), recipientId: assignee, type: tool, page };
    setFields((fs) => [...fs, f]);
    setSelected(f.key);
  }

  function startDrag(e: React.PointerEvent, f: EditorField, mode: "move" | "resize") {
    e.stopPropagation();
    const pageEl = (e.currentTarget as HTMLElement).closest("[data-page]") as HTMLElement;
    const r = pageEl.getBoundingClientRect();
    drag.current = { key: f.key, mode, startX: e.clientX, startY: e.clientY, orig: { x: f.x, y: f.y, w: f.w, h: f.h }, pageW: r.width, pageH: r.height };
    setSelected(f.key);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.pageW;
    const dy = (e.clientY - d.startY) / d.pageH;
    const next = d.mode === "move" ? { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy } : { ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy };
    setFields((fs) => fs.map((f) => (f.key === d.key ? { ...f, ...clampBox(next) } : f)));
  }

  async function save() {
    setMsg({});
    const res = await saveFieldsAction(props.envelopeId, fields.map(({ key: _k, ...f }) => f));
    setMsg(res.error ? { error: res.error } : { ok: `Saved ${res.count} fields` });
  }

  if (signers.length === 0) return <p className="border-brutal bg-yellow p-4 font-bold">Add at least one signer above, then place their fields.</p>;

  return (
    <div className="grid grid-cols-[14rem_1fr] gap-6" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <aside className="sticky top-4 h-fit space-y-4">
        <label className="block">
          <span className="mb-1 block font-mono text-xs font-bold uppercase">Assign to</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="border-brutal w-full px-2 py-2 font-bold" style={{ background: color(assignee) }}>
            {signers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="grid gap-2">
          {KINDS.map((k) => (
            <button key={k.type} type="button" aria-pressed={tool === k.type} onClick={() => setTool(tool === k.type ? null : k.type)}
              className={`border-brutal px-3 py-2 text-left font-bold ${tool === k.type ? "bg-ink text-paper" : "bg-paper hover:bg-yellow"}`}>{k.label}</button>
          ))}
        </div>
        <p className="font-mono text-xs">Pick a field type, then click on the page. Drag to move, drag the corner to resize, Delete to remove.</p>
        <Button variant="primary" type="button" onClick={save} className="w-full justify-center">Save fields</Button>
        {msg.error && <p role="alert" className="border-brutal bg-red p-2 text-sm font-bold text-white">{msg.error}</p>}
        {msg.ok && <p role="status" className="border-brutal bg-green p-2 text-sm font-bold">{msg.ok}</p>}
      </aside>
      <div className="space-y-6">
        {!doc && <p className="font-mono">Loading PDF...</p>}
        {doc && props.pageSizes.map((ps, i) => {
          const page = i + 1;
          const h = (ps.h / ps.w) * PAGE_W;
          return (
            <div key={page} data-page={page} data-testid={`page-${page}`} onClick={(e) => place(e, page)}
              className={`border-brutal shadow-hard relative bg-paper ${tool ? "cursor-crosshair" : ""}`} style={{ width: PAGE_W, height: h }}>
              <PdfCanvas doc={doc} pageNumber={page} width={PAGE_W} />
              {fields.filter((f) => f.page === page).map((f) => (
                <div key={f.key} role="button" tabIndex={0} aria-label={`${f.type} field`} onPointerDown={(e) => startDrag(e, f, "move")}
                  className={`absolute flex cursor-move select-none items-center border-2 border-ink px-1 font-mono text-[10px] font-bold uppercase ${selected === f.key ? "outline outline-2 outline-offset-2 outline-red" : ""}`}
                  style={{ left: f.x * PAGE_W, top: f.y * h, width: f.w * PAGE_W, height: f.h * h, background: color(f.recipientId) }}>
                  {f.type}
                  <span onPointerDown={(e) => startDrag(e, f, "resize")} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize border-2 border-ink bg-paper" />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Edit page**

`src/app/(app)/envelopes/[id]/edit/page.tsx`:
```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { RecipientsForm } from "./recipients-form";
import { FieldEditor } from "./editor";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireTenant();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getEnvelope(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (data.envelope.status !== "draft" || !data.document) redirect(`/envelopes/${id}`);
  const pdfUrl = await presignGet(data.document.s3Key, 3600);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="font-display text-4xl">{data.envelope.title}</h1>
        <Link href={`/envelopes/${id}`} className="font-bold underline">Back to envelope</Link>
      </div>
      <Card>
        <h2 className="mb-4 font-display text-2xl">1. Recipients</h2>
        <RecipientsForm envelopeId={id} initial={data.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, routingOrder: r.routingOrder }))} />
      </Card>
      <Card>
        <h2 className="mb-4 font-display text-2xl">2. Place fields</h2>
        <FieldEditor
          envelopeId={id}
          pdfUrl={pdfUrl}
          pageSizes={data.document.pageSizes}
          recipients={data.recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role }))}
          initial={data.fields.map((f) => ({ key: f.id, recipientId: f.recipientId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }))}
        />
      </Card>
    </div>
  );
}
```
If the pdf.js worker URL does not resolve under Turbopack, copy the worker into `public/`: add `"postinstall": "node -e \"require('fs').copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','public/pdf.worker.min.mjs')\""` to `package.json`, run it, and set `workerSrc = "/pdf.worker.min.mjs"`.

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS; build succeeds.
Manual: open an envelope with a PDF, add two signers, save, pick Signature, click on page 1, drag and resize it, Save fields, see "Saved 1 fields"; reload and the field is still there.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: recipients form and drag-and-drop field editor with pdf.js"
```

---

### Task 9: End-to-end test: create, upload, place, send

**Files:**
- Create: `e2e/send.spec.ts`, `e2e/helpers.ts`
- Modify: `e2e/team.spec.ts` (use the shared signup helper)

**Interfaces:**
- Consumes: UI contract from Tasks 7-8 (button names, labels, test ids).

- [ ] **Step 1: Shared helper**

`e2e/helpers.ts`:
```ts
import { expect, type Page } from "@playwright/test";

export type TestUser = { name: string; email: string; password: string };

export function newUser(tag: string): TestUser {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { name: `${tag} User`, email: `${tag}-${s}@e2e.dev`, password: "correct-horse-1" };
}

export async function fillSignup(page: Page, u: TestUser) {
  await page.getByLabel("Your name").fill(u.name);
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signUpWithWorkspace(page: Page, u: TestUser) {
  await page.goto("/signup");
  await fillSignup(page, u);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Workspace name").fill(`${u.name} Co`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Envelopes" })).toBeVisible();
}
```
Update `e2e/team.spec.ts` to import `fillSignup` from `./helpers` and delete its local copy.

- [ ] **Step 2: Write the e2e test**

`e2e/send.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { newUser, signUpWithWorkspace } from "./helpers";

async function pdfBuffer(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return Buffer.from(await doc.save());
}

test("create an envelope, upload, add signers, place a field, send", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("sender"));

  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill("E2E Contract");
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  await expect(page.getByRole("heading", { name: "E2E Contract" })).toBeVisible();

  await page.getByTestId("pdf-input").setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: await pdfBuffer(2) });
  await expect(page.getByText("(2 pages)")).toBeVisible();

  await page.getByRole("link", { name: "Edit recipients and fields" }).click();
  await page.getByLabel("Recipient 1 name").fill("Ann Signer");
  await page.getByLabel("Recipient 1 email").fill("ann@e2e.dev");
  await page.getByRole("button", { name: "Save recipients" }).click();
  await expect(page.getByRole("status")).toHaveText("Recipients saved");

  await page.getByRole("button", { name: "Signature" }).click();
  const page1 = page.getByTestId("page-1");
  await expect(page1.locator("canvas")).toBeVisible();
  await page1.click({ position: { x: 200, y: 800 } });
  await expect(page.getByRole("button", { name: "signature field" })).toBeVisible();
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved 1 fields");

  await page.getByRole("link", { name: "Back to envelope" }).click();
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Sent.")).toBeVisible();
  await expect(page.getByLabel("Signing link for ann@e2e.dev")).toHaveValue(/\/sign\//);

  await page.goto("/dashboard?status=sent");
  await expect(page.getByRole("link", { name: "E2E Contract" })).toBeVisible();
});

test("a text file renamed to .pdf is rejected", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("bad"));
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill("Bad upload");
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  await page.getByTestId("pdf-input").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some text") });
  await expect(page.getByRole("alert")).toContainText("not a valid PDF");
});
```

- [ ] **Step 3: Run**

Prereqs: `docker compose -f compose.dev.yml up -d`, `npm run db:migrate`.
Run: `npm run e2e`
Expected: 4 PASS (2 from Plan 1, 2 new).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: end-to-end envelope creation, upload, field placement and send"
```

---

## Self-review notes

- Spec coverage: section 2 envelopes/recipients/routing/fields/void (Tasks 4-6); section 4 data model + envelope states + tenant isolation for the new tables (Tasks 2, 4, 6); section 5 "Uploads" (Tasks 1, 4; size enforced server-side because the shared adapter signs PUT URLs) and step 1 token generation (Task 6); section 7 audit chain (Task 3; the event list is extended as later plans emit signer events); section 8 dashboard, upload, field editor, detail (Tasks 7-8); section 10 integration + e2e (all). Signer flow is Plan 3; emails, reminders, expiry jobs and finalization are Plan 4.
- Review Focus items pinned: 1 -> Task 4 (non-PDF, truncated) + Task 9 e2e; 2 -> Task 5; 3 -> Task 6; 4 -> Task 5; 5 -> Task 4.
- Types: `lockDraft`/`lockEnvelope` defined in Task 4 and used in Tasks 5-6; `hashToken` from Plan 1 `src/server/team/service.ts`; `FieldKind` (client) mirrors `FieldType` (server) values exactly.
