# Stampd

Multi-tenant e-signature app (Next.js, Prisma, Postgres RLS, S3 storage). Design: `docs/superpowers/specs/2026-09-28-stampd-design.md`.

## Local development

```bash
cp .env.example .env.local          # then fill in the blanks
docker compose -f compose.dev.yml up -d   # Postgres, RustFS (S3), Mailpit
npm install
npm run db:migrate
npm run storage:init
npm run dev                          # web app on http://localhost:3100
npm run worker                       # sends email, reminders and expiry (second terminal)
```

Email goes out only through the worker. With the Mailpit settings in `.env.example`, every email lands in the inbox at http://localhost:8025.

## Tests

```bash
npm test        # unit + integration (Testcontainers: Postgres, RustFS, Mailpit; needs Docker)
npm run e2e     # Playwright; needs the dev compose stack running
npm run lint
```
