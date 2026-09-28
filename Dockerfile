# syntax=docker/dockerfile:1.7
# One image, several roles: web (next start) and worker; plus "migrate" (schema changes) and "backup" targets.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# All dependencies (build tools, Prisma CLI) and the generated Prisma client.
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY public ./public
# prisma.config.ts needs a URL to load; generate never connects.
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=extra_ca,src=ca.crt ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    MIGRATOR_DATABASE_URL=postgres://build@localhost/build npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Server modules validate env at import; these placeholders only let `next build` load them.
ENV DATABASE_URL=postgres://build@localhost/build \
    BETTER_AUTH_SECRET=build-only-secret-build-only-secret-000 \
    BETTER_AUTH_URL=http://localhost:3100 \
    S3_BUCKET=build \
    S3_REGION=us-east-1
RUN npm run build && npm run build:worker

# Runtime dependencies only; no install scripts (the client is already generated into the build).
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Runs `prisma migrate deploy` (and one-off scripts such as storage:init) with the dev tooling.
FROM deps AS migrate
COPY scripts ./scripts
COPY src/server/finalize/dev-cert.ts ./src/server/finalize/dev-cert.ts
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/public ./public
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3100
# Web by default; the worker service runs: node --conditions=react-server dist/worker.mjs
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3100"]

# Nightly database backups: pg_dump from the server's major version, uploads with the AWS SDK.
FROM postgres:16-bookworm AS backup
COPY --from=base /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY scripts/backup.mjs ./backup.mjs
USER postgres
ENTRYPOINT ["node", "/app/backup.mjs"]
CMD ["daily"]
