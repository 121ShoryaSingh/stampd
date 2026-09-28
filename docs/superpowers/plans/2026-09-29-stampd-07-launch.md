# Stampd Plan 7: Launch readiness (accounts, pages, deployment)

**Goal:** Close the gaps between "works in development" and "can go live": emailed team invitations, password reset, public pages, a clean lint baseline, and a production deployment with backups and CI.

## Done

- **Team invitations by email** through the outbox (jobs without an envelope). The link is still shown once to the admin.
- **Password reset** (Better Auth): `/forgot-password`, `/reset-password`; reset links expire in 1 hour, work once, and sign out every device. The email is an *account* job with no tenant: RLS lets the app insert it (no RETURNING, so `createMany`) and only the worker flag read or update it.
- **Auth forms** keep their submit button disabled until hydration, so an early click can never submit a password in a URL.
- **Pages:** factual `/security`; `/terms` and `/privacy` as clearly marked drafts with [bracketed] parts for the business and a lawyer. Landing copy no longer claims Word conversion or at-rest encryption; pricing is labelled PLACEHOLDER like the stats and reviews; every footer link resolves (e2e checks it).
- **Lint:** zero errors and warnings (`npm run lint`); the vendored pdf.js worker is ignored.
- **Deployment:** multi-stage `Dockerfile` (runtime, migrate, backup targets), `compose.prod.yml` (Caddy TLS + headers + 26 MB limit, Postgres tuned for 4 GB on an internal network, migrate gate, worker with seal secret, health checks, memory/CPU limits), `/api/health`, worker heartbeat, esbuild worker bundle, Node backup tool (`pg_dump` to S3, `check` restores into a scratch database, `restore` for a fresh server), GitHub Actions CI (lint, types, tests, e2e, image builds), `DEPLOY.md`.

## Verified

- The production images were built and run: migrations from an empty database, `next start`, the bundled worker, Caddy on HTTPS; the e2e signing flow passed through Caddy against that stack, and the sealed PDF validated with `pdfsig`.
- Backups: `once`, `check` and a full `restore` into an empty database (grants, RLS policies and migration history restored).

## Needs the owner's decisions before launch

- Product name and domain; SMTP provider; object storage provider.
- A document-signing certificate from a CA on the Adobe Approved Trust List (self-issued works but readers show "issuer unknown").
- Real pricing (billing is out of scope for v1) and the lines that mention free documents; real stats, logos and reviews.
- Legal review of the terms and privacy drafts; a security contact address.
