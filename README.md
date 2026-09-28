# Stampd

Multi-tenant e-signature app: upload a PDF, place fields, send to signers in order, chase them automatically, and deliver a sealed, tamper-evident signed PDF with a certificate of completion.

Next.js 16, Prisma 7 on Postgres with row-level security, S3-compatible storage, SMTP email, and a background worker. Design: `docs/superpowers/specs/2026-09-28-stampd-design.md`; implementation plans in `docs/superpowers/plans/`.

## Local development

```bash
cp .env.example .env.local                 # then fill in the blanks
docker compose -f compose.dev.yml up -d    # Postgres, RustFS (S3), Mailpit
npm install
npm run db:migrate
npm run storage:init
npm run seal:dev-cert                      # self-issued seal certificate; add the printed lines to .env.local
npm run dev                                # web app on http://localhost:3100
npm run worker                             # seals PDFs, sends email, reminders and expiry (second terminal)
```

With the Mailpit settings in `.env.example`, every email lands in the inbox at http://localhost:8025.

## Tests

```bash
npm test        # unit + integration (Testcontainers: Postgres, RustFS, Mailpit; needs Docker)
npm run e2e     # Playwright; needs the dev compose stack running
npm run lint
```

## Deploying

See [DEPLOY.md](DEPLOY.md): one Docker image (web and worker), `compose.prod.yml` with Caddy, Postgres and nightly backups.
