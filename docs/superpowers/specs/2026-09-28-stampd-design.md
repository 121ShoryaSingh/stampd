# Stampd v1 - Design Spec

Date: 2026-09-28
Status: Draft for review
Working name: Stampd (rename freely)

## 1. Goal

A multi-tenant e-signature SaaS (DocuSign-style) for small teams worldwide.
v1 must let a company upload a PDF, place fields, send it to one or more
signers in a defined order, chase them automatically, and deliver a sealed,
tamper-evident signed PDF with a completion certificate.

Success for v1:
- A sender goes from PDF upload to "sent" in under 3 minutes.
- A signer with no account signs on a phone in under 1 minute.
- Two tenants can never see each other's data, enforced by the database.
- Every completed PDF shows as unmodified in Adobe Reader and includes a
  certificate page listing every signer, timestamp, IP and document hash.

## 2. Scope

In scope (v1):
- Tenants = companies. Users belong to tenants with role `admin` or `member`.
  Invite by email. One user may belong to several tenants.
- Envelopes containing one PDF document (multi-document later).
- Recipients with a routing order. Same order number = sign in parallel.
  Recipient roles: `signer`, `cc` (receives the final PDF only).
- Field types: signature, initials, date signed (auto), text, checkbox.
- Signer flow via emailed magic link + 6-digit email OTP; draw, type or
  upload a signature; explicit consent to sign electronically.
- Automatic reminders (interval in days) and envelope expiry.
- Decline (with reason) and void (by sender).
- Finalization: stamped PDF + certificate page + PAdES digital seal.
- Hash-chained, append-only audit log.
- Marketing site (Neo-Brutalist, GSAP), per the approved mockup.

Out of scope (v1): templates, billing/Stripe, public API/webhooks, bulk send,
SMS OTP, in-person signing, custom branding/subdomains, Aadhaar eSign or
eIDAS qualified signatures, multiple documents per envelope, document editing.

## 3. Architecture

Single Next.js (App Router, TypeScript) codebase, built into one Docker image,
run as two containers:

| Container | Command | Responsibility |
|---|---|---|
| web | `node server.js` | UI, server actions, route handlers, auth, presigned S3 URLs, enqueue jobs |
| worker | `node dist/worker.js` | pg-boss consumers: email, reminders, expiry, finalize |
| postgres | postgres:16 | tenant data (RLS), audit log, pg-boss queue |
| caddy | caddy:2 | TLS, body-size limit (25 MB), rate limits |

External: S3-compatible storage (Hetzner Object Storage or Cloudflare R2),
an SMTP server for email (nodemailer; same env names as SafetyShield/Horizon), an X.509 signing certificate for the PAdES seal.

Rule: heavy work (PDF stamping/sealing, email sending) never runs in `web`.
`web` writes rows and enqueues jobs, then returns.

### Libraries

Next.js 15+, React 19, TypeScript strict, Tailwind CSS, Drizzle ORM +
`postgres` driver, Better Auth, pg-boss, zod, pdf.js (viewer), pdf-lib (stamp),
@signpdf/signpdf + @signpdf/signer-p12 (seal), nodemailer (SMTP) with HTML-escaped templates, Mailpit for dev/tests,
@aws-sdk/client-s3 + s3-request-presigner, GSAP (marketing pages only),
Vitest, Testcontainers, Playwright.

### Source layout

```
src/
  app/
    (marketing)/          landing, pricing, legal
    (auth)/               login, signup, accept-invite
    (app)/                logged-in, tenant-scoped sender area
      dashboard/
      envelopes/new/
      envelopes/[id]/edit/
      envelopes/[id]/
      settings/team/
    sign/[token]/         public signer flow
    api/uploads/presign/  route handler
    api/webhooks/email/   route handler
    api/health/           route handler
  server/                 server-only business logic (import "server-only")
    db/ auth/ envelopes/ signing/ audit/ storage/ email/ jobs/
  worker/
    index.ts  handlers/  pdf/
  components/
```

Rules:
1. All business logic lives in `src/server/`; pages, actions, route handlers
   and the worker call it. No logic in components.
2. Every tenant-scoped DB access goes through `withTenant(tenantId, fn)`.
3. Server actions for app forms; route handlers only for presign, webhooks,
   health.
4. `/sign/[token]` has its own layout and never reads sender sessions.

## 4. Data model

All tenant-scoped tables carry `tenant_id uuid not null` with RLS.
IDs are UUIDv7. Timestamps are `timestamptz`.

- `tenants` (id, name, slug unique, created_at)
- Better Auth tables: `user`, `session`, `account`, `verification`
- `memberships` (tenant_id, user_id, role `admin|member`, created_at)
  PK (tenant_id, user_id)
- `invitations` (id, tenant_id, email, role, token_hash, invited_by,
  expires_at, accepted_at)
- `envelopes` (id, tenant_id, created_by, title, message, status,
  expires_at, reminder_every_days, last_error, sent_at, completed_at,
  voided_at, void_reason, sealed_s3_key, sealed_sha256, created_at)
- `documents` (id, tenant_id, envelope_id, filename, s3_key, sha256,
  page_count, size_bytes, created_at)
- `recipients` (id, tenant_id, envelope_id, name, email, role `signer|cc`,
  routing_order int, status, token_hash, otp_hash, otp_expires_at,
  otp_attempts, consented_at, viewed_at, signed_at, declined_at,
  decline_reason, last_reminded_at, sign_ip, sign_user_agent)
- `fields` (id, tenant_id, envelope_id, document_id, recipient_id, type,
  page int, x, y, w, h as numeric 0..1 of page size, required bool,
  value text, signature_s3_key)
- `audit_events` (id bigserial, tenant_id, envelope_id, actor_type
  `user|recipient|system`, actor_id, event, ip, user_agent, data jsonb,
  created_at, prev_hash, hash)

### Envelope states

```
draft -> sent -> completed
          |-> declined   (any signer declines)
          |-> voided     (sender voids)
          |-> expired    (expires_at passes)
```
Only `draft` is editable. Transitions happen in one transaction with a
`SELECT ... FOR UPDATE` on the envelope row plus an audit event.

Recipient states: `pending -> sent -> viewed -> signed | declined`.
A routing step is complete when all its signers are `signed`. Then the next
lowest `routing_order` step is sent. When no steps remain the envelope is
marked `completed` (pending seal) and `finalize-envelope` is enqueued.

### Tenant isolation

- App connects as role `stampd_app` (not table owner). Every tenant table has
  `ENABLE` and `FORCE ROW LEVEL SECURITY` with policy
  `tenant_id = current_setting('app.tenant_id', true)::uuid`.
- `withTenant(tenantId, fn)` opens a transaction and runs
  `set_config('app.tenant_id', $1, true)` before `fn`.
- Signer links resolve the tenant through one `SECURITY DEFINER` function
  `resolve_recipient(token_hash)` returning (tenant_id, recipient_id) only.
- A separate `stampd_migrator` role owns the schema and runs migrations.
- `audit_events`: `REVOKE UPDATE, DELETE` from `stampd_app`.
- Integration tests assert that tenant A cannot read or write tenant B rows
  through every repository function.

## 5. Signing flow and security

1. Sending creates a 32-byte random token per recipient; only its SHA-256 is
   stored. Link: `/sign/<token>`. Valid until envelope expiry or completion.
2. Opening the link: resolve recipient, check envelope status, log `viewed`.
3. OTP: 6 digits emailed to the recipient, hashed, 10-minute expiry, max 5
   attempts, then a new code is required. Rate-limited per recipient.
4. Consent screen: "I agree to use electronic records and signatures"
   stored as `consented_at` plus audit event.
5. Signer fills fields. Signature captured as PNG (draw, type, upload),
   uploaded via presigned URL to a recipient-scoped S3 prefix.
6. Submit: validate every required field for this recipient server-side,
   save values, set `signed`, record IP and user agent, append audit event,
   advance routing. All in one transaction.
7. Decline: reason required; envelope becomes `declined`; sender notified.

Uploads: presigned PUT limited to `application/pdf`, 25 MB, 200 pages
(page count checked server-side after upload with pdf-lib; rejected
otherwise). The original SHA-256 is computed server-side after upload.

## 6. Finalization (worker)

Job `finalize-envelope` (singleton key = envelope id, idempotent):
1. Load original PDF from S3; verify SHA-256 still matches `documents.sha256`.
2. Stamp field values and signature images with pdf-lib at stored
   coordinates.
3. Append a certificate page: envelope id, title, original hash, each
   recipient (name, email, IP, user agent, viewed/consented/signed times),
   and the final audit hash.
4. Seal with @signpdf using the tenant-independent Stampd certificate
   (PKCS#12 from a mounted secret). v1 may use a self-issued certificate:
   tampering is still detected, but Adobe shows "identity unknown" until a
   CA-issued document-signing certificate is bought (open item).
5. Upload sealed PDF, store key and SHA-256, email all recipients and the
   sender with a download link (signed URL, 7 days).
Failure: retry 3 times with backoff; then set `last_error` and show a
"finalization failed, retry" action to the sender.

Other jobs:
- `send-email`: render the template (all user text HTML-escaped), send over SMTP with nodemailer; retry 5 times with backoff.
- `reminder-tick` (cron hourly): recipients in `sent|viewed` whose
  envelope has `reminder_every_days` and `last_reminded_at` older than it.
- `expire-envelopes` (cron hourly): `sent` envelopes past `expires_at`.

## 7. Audit log

Each event stores `hash = sha256(prev_hash || canonical_json(event))`,
where `prev_hash` is the previous event's hash for the same envelope.
Events: created, document_uploaded, fields_updated, sent, email_sent,
email_failed, viewed, otp_sent, otp_failed, otp_verified, consented,
signed, declined, reminded, voided, expired, completed, sealed.
The final hash is printed on the certificate page.

## 8. UI

- Design language: Neo-Brutalist (option D): white, black 2.5 px borders,
  hard shadows, yellow/red-orange/pink/green accents, 0 px radius,
  Archivo Black + Space Grotesk + JetBrains Mono.
- Marketing: the approved landing page, rebuilt as React components, GSAP
  installed from npm (no CDN), animations disabled under
  `prefers-reduced-motion`.
- App screens: dashboard (status filters, counts), upload, field editor
  (pdf.js pages, drag fields from palette, assign recipient by color),
  envelope detail (recipient timeline, audit list, download), team settings.
- Signer screens: OTP, consent, guided field-by-field signing with a
  "next field" button, done screen. Mobile first.
- Placeholder stats and reviews must be replaced with real data before
  public launch (FTC and EU/UK consumer rules).

## 9. Error handling

- zod validation on every server action and route handler input.
- Domain errors (`NotFound`, `Forbidden`, `InvalidState`, `Validation`)
  mapped to user-safe messages; unexpected errors logged with a request id
  and shown generically.
- Jobs are idempotent and retried; permanent failures surface in the UI.
- SMTP send failures (connection, auth, rejected recipient) are retried; after the last
  retry the recipient is marked undeliverable and the sender sees it on the envelope.
  Asynchronous bounces are not tracked in v1 (plain SMTP has no bounce webhook).

## 10. Testing

- Unit (Vitest): routing logic, state transitions, audit hashing, field
  coordinate mapping, OTP.
- Integration (Vitest + Testcontainers Postgres): repositories under RLS,
  including cross-tenant leak tests for every table.
- PDF: finalize a fixture PDF, then verify the seal and that editing one
  byte breaks verification.
- E2E (Playwright): signup -> upload -> place fields -> send -> sign as two
  signers in order -> completed PDF downloadable.

## 11. Deployment

Docker Compose on a Hetzner CX22 per earlier decision: `web`, `worker`,
`postgres` (no published port, internal network), `caddy`. `mem_limit` and
`cpus` on every service, 2 GB swap, Postgres tuned for 4 GB
(`shared_buffers=1GB`, `max_connections=50`). Nightly `pg_dump -Fc` to
off-box storage with append-only credentials, restore tested once.
Local development: `docker compose -f compose.dev.yml` for Postgres and
MinIO (S3), `next dev` and `tsx watch src/worker/index.ts` on the host.

## 12. Open items

- Product name and domain.
- CA-issued document-signing certificate (for "identity verified" in Adobe).
- RFC 3161 timestamp authority choice (free TSA for v1, paid later).
- Legal review of consent text and terms before launch.
- Plan 4 must require a verified email before a user can accept an invitation (found in Plan 1 review).
