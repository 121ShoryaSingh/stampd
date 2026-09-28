# Stampd Plan 5: Email and Background Worker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stampd sends its own email. Signers get their invitation when their routing step starts, their 6-digit code by email, and reminders on the chosen interval. Senders hear about declines, completion and expiry. Envelopes expire on time. Failed deliveries show on the envelope page with a "Resend" button.

**Architecture:** A transactional outbox. Domain code writes an `email_jobs` row in the same Prisma transaction as the state change (so an email exists if and only if the change committed). A separate worker process (`npm run worker`, `src/worker/index.ts`) polls due jobs, sends them over SMTP with nodemailer, retries with backoff, and runs the reminder and expiry ticks. The worker finds work across tenants through read-only RLS policies enabled by a transaction-local `app.worker` flag; every write it makes still runs in `withTenant()` for that row's tenant.

**Tech Stack:** existing stack + `nodemailer` (already installed). Mailpit (container) for tests and optional local dev. No pg-boss.

**Spec:** `docs/superpowers/specs/2026-09-28-stampd-design.md` sections 3, 5, 6 ("Other jobs"), 7, 9. Plan 5, builds on the UI plan. PDF sealing and deployment move to Plan 6.

## Decisions (differences from the spec)

1. **Outbox instead of pg-boss.** Enqueueing must commit atomically with the state change, and app code is Prisma-only (no raw SQL outside `context.ts`). A Prisma-managed `email_jobs` table does both; pg-boss would need its own connection and raw SQL. Reminder/expiry "cron" jobs are timed loops in the worker; they are idempotent, so running several workers is safe.
2. **Links are issued when a step starts.** Only the SHA-256 of a signing token is stored, so a link cannot be re-created later. Tokens are created when a recipient's step starts (send for step 1, routing for later steps), and a reminder or "Resend" issues a fresh token; the older link then stops working. Later-step signers therefore have no link until it is their turn.
3. **Secrets leave the outbox after sending.** Job data holds the link or code only until the email is sent; then `url` and `code` are removed from the row.

## Global Constraints

- Everything in Plans 1-3 and the UI plan still applies (Prisma only, RLS, zod on inputs, ASCII, LF, short one-line comments, Neo-Brutalist UI, a11y).
- Every piece of user-provided text in an HTML email is HTML-escaped; subjects are single-line (CR/LF stripped) and at most 150 chars.
- Emails are sent only by the worker, never in a request.
- Delivery: at most 5 attempts, backoff 30 s, 2 min, 10 min, 30 min; then the job is `failed`, `email_failed` is audited, and the envelope page shows it.
- A job is claimed with a 2-minute lease (`lockedUntil`), so a crashed worker's job is retried and two workers never send the same job at once.
- Reminder due: signer in status `sent|viewed`, envelope `sent`, not expired, `reminderEveryDays` set, and `(lastRemindedAt ?? invitedAt) <= now - reminderEveryDays days`.
- Expiry: envelope `sent` with `expiresAt <= now` becomes `expired` (audited, sender emailed).
- Env: `SMTP_HOST`, `SMTP_PORT` (465 = implicit TLS, else STARTTLS), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`. The web app starts without them; the worker refuses to start without host and from address.
- Audit events added: `email_sent`, `email_failed`, `reminded`, `expired`, `link_reissued`.

## Review Focus

1. A rolled-back state change must not send an email (outbox row in the same transaction). Pinned in Task 2.
2. Two workers (or a crash mid-send) must not double-send, and a stuck lease is retried. Pinned in Task 3.
3. HTML injection through titles, names, messages or decline reasons. Pinned in Task 1.
4. A step-2 signer must not get a working link before step 1 finishes; an old link stops working after a reminder or resend. Pinned in Task 2 and Task 4.
5. Reminders and expiry are idempotent: running the tick twice sends one reminder and one expiry email. Pinned in Task 4.
6. Codes and links do not stay in the database after the email is sent. Pinned in Task 3.
7. The worker's cross-tenant flag gives read-only discovery; it must not allow writes. Pinned in Task 2.

---

## File Structure

```
prisma/schema.prisma                         + EmailJob, EmailStatus, Recipient.invitedAt
prisma/migrations/<ts>_email/migration.sql   table, RLS, worker read policies
src/server/db/context.ts                     + DbContext.worker (app.worker flag)
src/server/env.ts                            + SMTP / EMAIL_FROM settings (optional)
src/server/email/templates.ts                renderEmail(kind, data), escapeHtml()
src/server/email/mailer.ts                   smtpTransport(), sendMail()
src/server/email/outbox.ts                   enqueueEmail(), processDueEmails(), deliveries()
src/server/envelopes/links.ts                issueLink() (token + invite job)
src/server/envelopes/send.ts                 invites via outbox, no links returned
src/server/signing/submit.ts                 next step invites, decline/complete notices
src/server/signing/service.ts                code by email (no dev code)
src/server/envelopes/service.ts              void notices, resendInvite()
src/server/jobs/ticks.ts                     remindDue(), expireDue()
src/worker/index.ts                          poll loop + ticks, graceful stop
src/app/(app)/envelopes/[id]/...             delivery status, Resend button, "emails on their way"
src/app/sign/[token]/...                     "check your email" code step
tests/helpers/mail.ts                        Mailpit container helpers, outbox readers
compose.dev.yml                              + mailpit
```

---

### Task 1: Templates and SMTP transport

**Files:** `src/server/email/templates.ts`, `src/server/email/mailer.ts`, `src/server/env.ts`, tests `src/server/email/templates.test.ts`, `src/server/email/mailer.test.ts`, `tests/global-setup.ts` (Mailpit container), `tests/setup.ts`.

**Interfaces (produced):**
- `type EmailKind = "invite" | "reminder" | "otp" | "declined" | "completed" | "expired" | "voided"`
- `escapeHtml(s: string): string`
- `renderEmail(kind, data): { subject: string; text: string; html: string }`
- `sendMail(m: { to: string; toName?: string | null; subject; text; html }): Promise<void>` (throws on SMTP errors)

- [ ] Tests first: every kind renders subject/text/html; `<script>` and quotes in title, sender name, message and reason are escaped in HTML; CR/LF are stripped from subjects; links appear in both text and HTML; `sendMail` delivers to Mailpit (read back through the Mailpit API) with the configured From.
- [ ] Implement; `npm test` green; commit `feat: email templates and SMTP transport`.

### Task 2: Outbox table, worker read policies and enqueueing from domain code

**Files:** schema + migration `email`, `src/server/db/context.ts`, `src/server/email/outbox.ts` (`enqueueEmail`), `src/server/envelopes/links.ts`, `src/server/envelopes/send.ts`, `src/server/signing/submit.ts`, `src/server/signing/service.ts`, `src/server/envelopes/service.ts`, `tests/helpers/signing.ts`, `tests/helpers/mail.ts`, tests.

**Interfaces (produced):**
- `EmailJob { id, tenantId, envelopeId, recipientId?, kind, toEmail, toName?, data Json, status queued|sent|failed, attempts, runAt, lockedUntil?, lastError?, sentAt?, createdAt }`
- `enqueueEmail(tx, { tenantId, envelopeId, recipientId?, kind, toEmail, toName?, data })`
- `issueLink(tx, { tenantId, envelopeId, recipient, kind: "invite" | "reminder" }, ctx)`: new token, `invitedAt` on first issue, job with `url`
- `sendEnvelope()` returns `{ invited: number }`; `requestCode()` returns `void`
- `withDb({ worker: true }, fn)` sets `app.worker = 'on'`; policies `worker_read` (SELECT only) on `email_jobs`, `envelopes`, `recipients`

- [ ] Tests first: send creates invite jobs for step-1 signers only, no token for later steps; a failed send (validation) leaves no jobs; finishing step 1 issues step-2 links and jobs; decline emails the sender with the reason; completion emails the sender; void emails every recipient who got a link; requesting a code creates an `otp` job holding the code; `withDb({ worker: true })` can read jobs, envelopes and recipients of every tenant but cannot update or insert; without the flag nothing leaks.
- [ ] Update Plan 3 tests and helpers to take links from the outbox; `npm test` green; commit `feat: email outbox written with domain changes`.

### Task 3: Delivery (claim, send, retry, scrub)

**Files:** `src/server/email/outbox.ts` (`processDueEmails`, `deliveries`), tests.

**Interfaces (produced):**
- `processDueEmails({ now?, send?, limit? }): Promise<{ sent: number; failed: number; retried: number }>`
- `deliveries(tenantId, envelopeId): Promise<Record<recipientId | "sender", { status; lastError; at }>>` (latest job per recipient)

- [ ] Tests first: a due job is sent once and marked `sent` with `url`/`code` removed and `email_sent` audited; two concurrent `processDueEmails` calls send it once; an expired lease is picked up again; SMTP errors back off (`runAt` moves 30 s, 2 min...) and the 5th failure marks `failed` + `email_failed`; jobs with a future `runAt` wait.
- [ ] Implement; commit `feat: email delivery with leases and retries`.

### Task 4: Reminders, expiry and resend

**Files:** `src/server/jobs/ticks.ts`, `src/server/envelopes/service.ts` (`resendInvite`), tests.

**Interfaces (produced):**
- `remindDue(now?)`: `{ reminded: number }`; `expireDue(now?)`: `{ expired: number }`
- `resendInvite({ tenantId, userId, envelopeId, recipientId })`

- [ ] Tests first: a signer invited N days ago with `reminderEveryDays = N` gets one reminder (fresh link, old link rejected, `reminded` audited); a second tick in the same hour sends nothing; no reminders when off, expired, voided, signed, or step not started; an envelope past `expiresAt` becomes `expired` once with one sender email; resend works only for active signers of a `sent` envelope.
- [ ] Implement; commit `feat: reminders, expiry and resend`.

### Task 5: Worker process

**Files:** `src/worker/index.ts`, `package.json` (`worker` script), `compose.dev.yml` (mailpit), `.env.example`, `README.md`.

- [ ] Loop: `processDueEmails` every 2 s; `expireDue` then `remindDue` every 5 min; one failing iteration is logged and does not stop the loop; SIGINT/SIGTERM finish the current iteration, then disconnect Prisma.
- [ ] Refuses to start without SMTP host / from address (clear message).
- [ ] Smoke run against Mailpit: send an envelope in dev, see the invite in Mailpit.
- [ ] Commit `feat: background worker process`.

### Task 6: UI

**Files:** `src/app/(app)/envelopes/[id]/{page,send-form,actions,parts}.tsx`, `src/app/sign/[token]/{page,code-step}.tsx`, e2e helpers and specs.

- [ ] Send form: "Sent. Signing emails are on their way." (no links).
- [ ] Recipient timeline: per-recipient delivery (queued / sent / failed with reason) and a "Resend" button for active signers.
- [ ] Code step: "We emailed a code to <email>"; no on-screen code.
- [ ] E2E runs a worker and Mailpit; helpers read links and codes from Mailpit. Existing flows still pass; axe clean.
- [ ] Commit `feat: delivery status, resend and email-based signing in the UI`.
