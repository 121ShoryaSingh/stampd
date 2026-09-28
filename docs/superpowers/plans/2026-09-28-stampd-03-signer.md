# Stampd Plan 3: Signer Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A recipient opens their signing link, proves it is them with a 6-digit code, agrees to sign electronically, fills their fields (draw/type/upload a signature), and finishes; the envelope then moves to the next signer in order, or to `completed`. Recipients can also decline.

**Architecture:** A public route `/sign/[token]` with its own layout. The token resolves the recipient through an RLS read policy keyed on `app.token_hash` (Prisma query, no SQL); every write then runs in that recipient's tenant context. After the code check, a signer session cookie (HMAC over recipient id + verification time, keyed by `BETTER_AUTH_SECRET`) authorizes the next steps. All rules live in `src/server/signing/*`; the page calls them through server actions.

**Tech Stack:** as Plans 1-2 (Prisma 7, Next.js 16, storage adapter, pdf.js). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-stampd-design.md` section 5 (steps 2-7), 4 (recipient states, routing), 7 (audit events), 8 (signer screens). Plan 3 of 5, builds on `plan-2-envelopes`.

## Global Constraints

- Everything in Plans 1, 1b and 2 still applies (Prisma only, no raw SQL outside `src/server/db/context.ts`, RLS, zod on every action, ASCII, LF, short one-line comments, Neo-Brutalist design).
- Code: 6 digits, stored as HMAC-SHA256 (`BETTER_AUTH_SECRET`), valid 10 minutes, max 5 wrong tries then a new code is required, at most one new code per 30 seconds.
- Until Plan 4 sends email, the page shows the code on screen only when `NODE_ENV !== "production"`, clearly labelled "dev only". In production, requesting a code without an email service fails loudly.
- Signer session cookie: `sg_<recipientId>`, httpOnly, sameSite lax, path `/sign`, 2 hours.
- A signer can act only when: envelope `sent`, `expiresAt` in the future, recipient status `sent` or `viewed` (their routing step is active).
- Signature/initials images: PNG only, max 300 KB each, stored at `t/<tenant>/e/<envelope>/sig/<recipient>/<uuid>.png`.
- Field values: text max 500 chars; checkbox `"true"`/`"false"`; date fields are filled by the server with the signing date (UTC, `YYYY-MM-DD`), never by the client.
- Audit events added: `viewed`, `otp_sent`, `otp_failed`, `otp_verified`, `consented`, `signed`, `declined`, `step_started`, `completed`. Each carries ip and user agent where available.

## Review Focus

1. A signer whose turn has not come yet (routing step 2 while step 1 is signing) must see "waiting for others" and be unable to sign. Pinned in Task 2.
2. Guessing codes: after 5 wrong codes the code is dead and a new one is required; a correct code after that still fails. Pinned in Task 2.
3. Submitting twice (double click, two tabs) must record one signature; the second attempt says "already signed". Pinned in Task 3.
4. A link used after the envelope expired (even before any cleanup job runs) or was voided must be refused. Pinned in Task 2.
5. Field values for another recipient's fields, a non-PNG or oversized signature image, or a missing required field must be rejected. Pinned in Task 3.
6. A session cookie from one recipient must not unlock another recipient's link. Pinned in Task 2.

---

## File Structure

```
prisma/schema.prisma                         + Recipient.otpSentAt, otpVerifiedAt
prisma/migrations/<ts>_signer/migration.sql  columns + recipients token_read policy
src/server/signing/session.ts                signerSessionValue(), isValidSession()
src/server/signing/otp.ts                    newCode(), hashCode(), OTP constants
src/server/signing/access.ts                 resolveSigner(), signerState()
src/server/signing/service.ts                openLink, requestCode, verifyCode, consent, getSigningView
src/server/signing/submit.ts                 submitSigning(), declineSigning(), advanceRouting()
src/server/signing/png.ts                    decodePng() (data URL -> bytes, validated)
src/app/sign/layout.tsx
src/app/sign/[token]/page.tsx                state machine: waiting / code / consent / sign / done
src/app/sign/[token]/actions.ts
src/app/sign/[token]/code-step.tsx, consent-step.tsx, sign-step.tsx, signature-pad.tsx
tests/helpers/signing.ts                     sentEnvelope() fixture
e2e/sign.spec.ts
```

---

### Task 1: Schema, token read policy, session and code helpers

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration `signer`, `src/server/signing/session.ts`, `src/server/signing/otp.ts`, `src/server/signing/helpers.test.ts`, `tests/db/rls-signer.test.ts`

**Interfaces:**
- Produces:
  - `OTP_TTL_MS = 600_000`, `OTP_MAX_ATTEMPTS = 5`, `OTP_RESEND_MS = 30_000`
  - `newCode(): string` (6 digits, crypto random), `hashCode(recipientId: string, code: string): string`
  - `SESSION_TTL_MS = 7_200_000`, `sessionCookieName(recipientId)`, `signerSessionValue(recipientId: string, verifiedAt: Date): string`, `isValidSession(value: string | undefined, recipientId: string, verifiedAt: Date | null, now?: Date): boolean`
  - RLS: `recipients` SELECT allowed when `token_hash = app_token_hash()`

- [ ] **Step 1:** Add to `model Recipient`:
```prisma
  otpSentAt      DateTime?       @map("otp_sent_at") @db.Timestamptz
  otpVerifiedAt  DateTime?       @map("otp_verified_at") @db.Timestamptz
```
Run `npx prisma migrate dev --create-only --name signer`, then append to the generated `migration.sql`:
```sql
-- A signing link may read its own recipient row (to find the tenant).
create policy token_read on recipients for select
  using (token_hash = app_token_hash());
```
Run `npx prisma migrate dev` (applies to dev) and `npx prisma generate`.

- [ ] **Step 2: Failing tests**

`src/server/signing/helpers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newCode, hashCode } from "./otp";
import { signerSessionValue, isValidSession, SESSION_TTL_MS } from "./session";

describe("codes", () => {
  it("are 6 digits and vary", () => {
    const codes = new Set(Array.from({ length: 50 }, newCode));
    expect([...codes].every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(codes.size).toBeGreaterThan(40);
  });
  it("hash per recipient", () => {
    expect(hashCode("r1", "123456")).toBe(hashCode("r1", "123456"));
    expect(hashCode("r1", "123456")).not.toBe(hashCode("r2", "123456"));
  });
});

describe("signer session", () => {
  const at = new Date("2026-01-01T10:00:00Z");
  it("accepts its own value within the TTL", () => {
    expect(isValidSession(signerSessionValue("r1", at), "r1", at, new Date(at.getTime() + 60_000))).toBe(true);
  });
  it("rejects another recipient, a changed verification time, expiry, and garbage", () => {
    const v = signerSessionValue("r1", at);
    expect(isValidSession(v, "r2", at, at)).toBe(false);
    expect(isValidSession(v, "r1", new Date(at.getTime() + 1), at)).toBe(false);
    expect(isValidSession(v, "r1", at, new Date(at.getTime() + SESSION_TTL_MS + 1))).toBe(false);
    expect(isValidSession("nope", "r1", at, at)).toBe(false);
    expect(isValidSession(undefined, "r1", at, at)).toBe(false);
    expect(isValidSession(v, "r1", null, at)).toBe(false);
  });
});
```

`tests/db/rls-signer.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../helpers/db";
import { seedDraft } from "../helpers/envelopes";
import { withDb } from "@/server/db/context";

const admin = adminDb();
let t: string;
beforeAll(async () => {
  t = await insertTenant(admin, "SignRls");
  const u = await insertUser(admin);
  const env = await seedDraft(admin, t, u.id);
  await admin.recipient.createMany({ data: [
    { tenantId: t, envelopeId: env, name: "A", email: "a@x.dev", tokenHash: "tok-a" },
    { tenantId: t, envelopeId: env, name: "B", email: "b@x.dev", tokenHash: "tok-b" },
  ] });
});
afterAll(async () => { await admin.$disconnect(); });

describe("recipient token policy", () => {
  it("a token reveals only its own recipient", async () => {
    const rows = await withDb({ tokenHash: "tok-a" }, (tx) => tx.recipient.findMany());
    expect(rows.map((r) => r.email)).toEqual(["a@x.dev"]);
  });
  it("a token reveals nothing else", async () => {
    const [envs, fields] = await withDb({ tokenHash: "tok-a" }, async (tx) => [await tx.envelope.findMany(), await tx.field.findMany()]);
    expect(envs).toHaveLength(0);
    expect(fields).toHaveLength(0);
  });
});
```
Run: `npx vitest run src/server/signing tests/db/rls-signer.test.ts` -> FAIL (modules missing; policy missing if run before Step 1 migration).

- [ ] **Step 3: Implement**

`src/server/signing/otp.ts`:
```ts
import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { env } from "@/server/env";

export const OTP_TTL_MS = 600_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 30_000;

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(recipientId: string, code: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`otp|${recipientId}|${code}`).digest("hex");
}
```

`src/server/signing/session.ts`:
```ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

export const SESSION_TTL_MS = 7_200_000;
export const sessionCookieName = (recipientId: string) => `sg_${recipientId.replace(/-/g, "")}`;

// Bound to the verification time, so a new code invalidates old sessions.
export function signerSessionValue(recipientId: string, verifiedAt: Date): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`sess|${recipientId}|${verifiedAt.toISOString()}`).digest("base64url");
}

export function isValidSession(value: string | undefined, recipientId: string, verifiedAt: Date | null, now = new Date()): boolean {
  if (!value || !verifiedAt) return false;
  if (now.getTime() - verifiedAt.getTime() > SESSION_TTL_MS) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(signerSessionValue(recipientId, verifiedAt));
  return a.length === b.length && timingSafeEqual(a, b);
}
```
Run the two test files -> PASS. `npm test` -> all PASS. Commit `feat: signer session, codes and recipient token policy`.

---

### Task 2: Opening a link, the code check, consent

**Files:**
- Create: `src/server/signing/access.ts`, `src/server/signing/service.ts`, `src/server/signing/service.test.ts`, `tests/helpers/signing.ts`

**Interfaces:**
- Consumes: `withDb`, `withTenant`, `hashToken` (team service), `appendAudit`, `lockEnvelope`, `sendEnvelope` and friends (tests), Task 1 helpers.
- Produces:
  - `type SignerState = "ready" | "waiting" | "signed" | "declined" | "closed"` (closed = voided/expired/completed/declined envelope)
  - `type SignerRef = { tenantId: string; envelopeId: string; recipientId: string }`
  - `type ReqMeta = { ip: string | null; userAgent: string | null }`
  - `resolveSigner(token: string): Promise<SignerRef>` (NotFound on unknown token)
  - `openLink(token, meta): Promise<{ ref; state: SignerState; name; email; title; senderMessage; verified: boolean; otpVerifiedAt: Date | null; consented: boolean }>` (first open of a ready recipient: status `viewed`, audit `viewed`)
  - `requestCode(token, meta): Promise<{ devCode: string | null }>`
  - `verifyCode(token, code, meta): Promise<{ recipientId: string; verifiedAt: Date }>` (throws ValidationError "Wrong code" / "Too many attempts, request a new code" / "Code expired")
  - `giveConsent(token, session, meta): Promise<void>`
  - `requireSignerSession(token, session): Promise<{ ref; recipient }>` (ForbiddenError when session invalid; InvalidState when not ready)
  - `getSigningView(token, session)`: `{ title, pdfUrl, pageSizes, fields: { id, type, page, x, y, w, h, required }[] }`
  - test fixture `sentEnvelope({ signers: number, sameStep?: boolean })` returning `{ tenantId, envelopeId, userId, links: { email, token, recipientId }[] }`

- [ ] **Step 1: Fixture** `tests/helpers/signing.ts`: creates a user + tenant (createTenant), an envelope with a 1-page PDF, N signers (`s1@x.dev`...) with routing orders 1..N (or all 1 if `sameStep`), one signature + one date field each, sends it (`sendEnvelope`), and returns tokens parsed from the links.
```ts
import { insertUser, type AdminDb } from "./db";
import { makePdf } from "./pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject } from "@/server/storage/storage";
import { createEnvelope, finalizeUpload, uploadKeyFor } from "@/server/envelopes/service";
import { setRecipients } from "@/server/envelopes/recipients";
import { saveFields } from "@/server/envelopes/fields";
import { sendEnvelope } from "@/server/envelopes/send";

export async function sentEnvelope(admin: AdminDb, opts: { signers?: number; sameStep?: boolean; withText?: boolean } = {}) {
  const n = opts.signers ?? 1;
  const userId = (await insertUser(admin)).id;
  const { id: tenantId } = await createTenant({ userId, name: "Signing Co" });
  const { id: envelopeId } = await createEnvelope({ tenantId, userId, title: "Service Agreement" });
  const key = uploadKeyFor(tenantId, envelopeId);
  await putObject(key, await makePdf(1), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId, key, filename: "sa.pdf" });
  const recs = await setRecipients({
    tenantId, userId, envelopeId,
    recipients: Array.from({ length: n }, (_, i) => ({ name: `Signer ${i + 1}`, email: `s${i + 1}@x.dev`, role: "signer" as const, routingOrder: opts.sameStep ? 1 : i + 1 })),
  });
  await saveFields({
    tenantId, userId, envelopeId,
    fields: recs.flatMap((r, i) => [
      { recipientId: r.id, type: "signature" as const, page: 1, x: 0.1, y: 0.1 + i * 0.2, w: 0.3, h: 0.06 },
      { recipientId: r.id, type: "date" as const, page: 1, x: 0.5, y: 0.1 + i * 0.2, w: 0.2, h: 0.03 },
      ...(opts.withText ? [{ recipientId: r.id, type: "text" as const, page: 1, x: 0.1, y: 0.18 + i * 0.2, w: 0.3, h: 0.03 }] : []),
    ]),
  });
  const links = await sendEnvelope({ tenantId, userId, envelopeId, expiresInDays: 30, reminderEveryDays: null });
  return {
    tenantId, envelopeId, userId,
    links: links.map((l) => ({ email: l.email, recipientId: l.recipientId, token: l.url.split("/sign/")[1] })),
  };
}
```

- [ ] **Step 2: Failing tests** `src/server/signing/service.test.ts` covering:
  - unknown token -> NotFound; first open of signer 1 -> state `ready`, recipient `viewed`, audit `viewed`; second open adds no second `viewed` event.
  - signer 2 in a 2-step envelope -> state `waiting` and `requestCode` rejects with /not your turn/.
  - envelope voided -> `closed`; envelope past `expiresAt` (set via admin) -> `closed` and `requestCode` rejects.
  - `requestCode` returns a 6-digit devCode, stores only a hash, audit `otp_sent`; asking again within 30 s -> /wait/.
  - `verifyCode` wrong code -> /Wrong code/, `otpAttempts` increments, audit `otp_failed`; after 5 wrong -> /Too many attempts/ even with the right code; a new code works again.
  - expired code (set `otpExpiresAt` in the past) -> /expired/.
  - correct code -> returns `verifiedAt`; `requireSignerSession(token, signerSessionValue(id, verifiedAt))` passes; a session value for recipient B on recipient A's token -> Forbidden.
  - `giveConsent` sets `consentedAt`, audit `consented`; `getSigningView` before consent -> /consent/; after -> only this recipient's fields and a PDF url.

- [ ] **Step 3: Implement** `access.ts` (`resolveSigner` via `withDb({ tokenHash: hashToken(token) })` then `tx.recipient.findFirst({ where: { tokenHash } })`; `signerState(envelope, recipient, now)` pure function) and `service.ts` with the functions above. Writes run in `withTenant(ref.tenantId, ...)`; `requestCode`/`verifyCode` first `lockEnvelope`-style touch the recipient row via a conditional `updateMany` so concurrent code checks serialize; code compare uses the stored hash with `timingSafeEqual`.

- [ ] **Step 4:** Tests PASS, `npm test` PASS. Commit `feat: signer link access, code verification and consent`.

---

### Task 3: Submitting, declining and routing

**Files:**
- Create: `src/server/signing/png.ts`, `src/server/signing/submit.ts`, `src/server/signing/submit.test.ts`

**Interfaces:**
- Produces:
  - `decodePng(dataUrl: string, maxBytes = 300_000): Uint8Array` (ValidationError unless `data:image/png;base64,` + PNG magic `89 50 4E 47 0D 0A 1A 0A` + size limit)
  - `type SubmitInput = { values: Record<string, string>; signaturePng?: string; initialsPng?: string }` (values keyed by field id, for text/checkbox)
  - `submitSigning(token, session, input, meta): Promise<{ envelopeStatus: "sent" | "completed"; nextStepStarted: boolean }>`
  - `declineSigning(token, session, reason, meta): Promise<void>`

- [ ] **Step 1: Failing tests** `submit.test.ts`:
  - happy path, 1 signer: signature image stored (object exists), date field value is today's UTC date, recipient `signed` with ip/ua, envelope `completed` with `completedAt`, audit ends `signed`,`completed`, chain verifies.
  - 2 signers in order: after signer 1, signer 2 becomes `sent` (audit `step_started`), envelope still `sent`; after signer 2, `completed`.
  - 2 signers in the same step: first submit does not complete; second completes.
  - second submit by the same signer -> /already signed/; concurrent double submit -> exactly one fulfilled.
  - missing signature image when a signature field exists -> /signature/; non-PNG data URL -> /PNG/; 301 KB PNG -> /too large/.
  - a `values` key that is another recipient's field id -> /not yours/; text over 500 chars -> /500/; missing required text -> /required/.
  - decline: reason required; recipient `declined`, envelope `declined`, audit `declined`; later submit by anyone -> closed.

- [ ] **Step 2: Implement** `submit.ts`: `requireSignerSession`, then in `withTenant`: claim the recipient with `tx.recipient.updateMany({ where: { id, status: { in: ["sent", "viewed"] } }, data: { status: "signed", signedAt, signIp, signUserAgent } })` (count 0 -> "already signed" or closed); lock the envelope (`lockEnvelope`), re-check it is `sent` and not expired; validate every field of this recipient (server-filled dates, PNG uploads via `putObject` done before the transaction and keys passed in), update field values, append `signed`; `advanceRouting(tx, ...)`: if any signer in the lowest unfinished step is not `signed` -> stop; else set the next step's signers to `sent` + `step_started`, or if none remain set envelope `completed` + `completedAt` + audit `completed`. Uploaded images are deleted if the transaction fails.

- [ ] **Step 3:** Tests PASS, `npm test` PASS. Commit `feat: signing submission, decline and routing to the next signer`.

---

### Task 4: Signer pages

**Files:**
- Create: `src/app/sign/layout.tsx`, `src/app/sign/[token]/page.tsx`, `actions.ts`, `code-step.tsx`, `consent-step.tsx`, `sign-step.tsx`, `signature-pad.tsx`

**Interfaces:**
- Consumes: Task 2-3 services; `PdfCanvas` from the editor (move to `src/components/pdf/pdf-canvas.tsx` and update the editor import).
- UI contract for e2e: headings "Waiting for others", "Enter your code", "Before you sign", "All done", "This envelope is closed"; buttons "Send me a code", "Verify", "I agree", "Adopt signature", "Finish", "Decline"; dev code shown in an element with `data-testid="dev-code"`; signature pad canvas `data-testid="signature-pad"`; field boxes as buttons named "<type> field".

- [ ] **Step 1:** Layout: minimal header (logo + "Secured by Stampd"), no app sidebar, never reads sender sessions.
- [ ] **Step 2:** `page.tsx` (server): `openLink(token, meta)` using `headers()` for ip (`x-forwarded-for` first value) and user agent; reads cookie `sessionCookieName(recipientId)`; renders by state: waiting / closed / signed ("All done") / declined, else: not verified -> `CodeStep`; verified but not consented -> `ConsentStep`; else `SignStep` with `getSigningView`.
- [ ] **Step 3:** `actions.ts`: `requestCodeAction`, `verifyCodeAction` (sets the httpOnly cookie on success), `consentAction`, `submitAction`, `declineAction`, each zod-validated, mapping DomainError to `{ error }`.
- [ ] **Step 4:** `signature-pad.tsx`: tabs Draw (pointer events on a canvas, smoothed quadratic strokes), Type (name rendered on a canvas in a script-style system font), Upload (PNG/JPG converted to PNG through a canvas, downscaled to max 600x200); outputs a PNG data URL; "Adopt signature".
- [ ] **Step 5:** `sign-step.tsx`: renders pages with `PdfCanvas`, overlays only this signer's fields; a sticky bar with progress ("2 of 3 required") and "Next field" that scrolls to and focuses the next unfilled required field; signature/initials fields open the pad; text fields are inputs; checkboxes toggle; date shows "filled on finish"; "Finish" enabled when all required are filled; "Decline" opens a reason form. Mobile: pages scale to viewport width.
- [ ] **Step 6:** `npm test && npm run build`. Manual: send to yourself, open the link, complete the flow. Commit `feat: signer pages with code check, consent, signature pad and guided signing`.

---

### Task 5: End-to-end signing

**Files:**
- Create: `e2e/sign.spec.ts`

- [ ] **Step 1:** Test A: sender creates an envelope with two signers in order (reuse the Plan 2 e2e steps via helpers; place a signature field for each), sends, reads both links. Signer 2's link shows "Waiting for others". Signer 1 opens the link in a fresh context: "Send me a code", reads `dev-code`, "Verify", "I agree", clicks the signature field, draws on `signature-pad`, "Adopt signature", "Finish" -> "All done". Signer 2's link now shows "Enter your code"; completes the same way. Sender's envelope page shows status `completed`.
- [ ] **Step 2:** Test B: a signer declines with a reason; sender sees `declined`; the other signer's link shows "This envelope is closed".
- [ ] **Step 3:** `npm run e2e` -> all PASS. Commit `test: end-to-end signing, routing and decline`.

## Self-review notes

- Spec section 5 steps 2-7 -> Tasks 2-4; recipient states and routing (section 4) -> Task 3; audit events (section 7) -> Tasks 2-3; signer screens (section 8) -> Task 4; tests (section 10) -> all tasks. Email delivery of codes and links, final PDF sealing, reminders and expiry jobs are Plan 4.
- Review Focus 1, 2, 4, 6 -> Task 2 tests; 3, 5 -> Task 3 tests.
