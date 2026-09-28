# Deploying Stampd

One small server runs everything with Docker Compose (`compose.prod.yml`):

| Service | What it does |
|---|---|
| `caddy` | HTTPS with automatic certificates, security headers, 26 MB request limit |
| `web` | The Next.js app (`next start`), health check at `/api/health` |
| `worker` | Seals completed envelopes, sends email, reminders and expiry |
| `postgres` | Postgres 16, only reachable from inside the stack |
| `migrate` | Applies database migrations, then exits (web and worker wait for it) |
| `backup` | Nightly `pg_dump` to a separate S3 bucket |

Documents and signed PDFs live in S3-compatible object storage (Cloudflare R2, Hetzner Object Storage or AWS S3). Email goes out over SMTP.

## 1. Server

- A VM with 2 vCPU and 4 GB RAM is enough to start (e.g. Hetzner CX22), Ubuntu 24.04, Docker Engine with the Compose plugin.
- Add 2 GB of swap:
  ```bash
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```
- Open only ports 22, 80 and 443. Point your domain's A/AAAA record at the server.

## 2. Accounts you need

1. **Object storage** bucket for documents, with an access key limited to that bucket. Turn on versioning if your provider supports it: backups cover the database, and versioning protects the files.
2. **Backup bucket**, ideally at another provider, with a key that can add objects but not delete them. Add a lifecycle rule to expire old dumps (for example after 35 days).
3. **SMTP** credentials from an email provider, with SPF and DKIM set up for the sending domain.
4. **Seal certificate** (PKCS#12, `.p12`). Buy a document-signing certificate from a CA on the Adobe Approved Trust List so readers show a trusted identity. For staging you can make a self-issued one (see step 4); readers then show the seal as valid but the issuer as unknown.

## 3. Configure

```bash
git clone <your repo> stampd && cd stampd
cp .env.production.example .env.production && chmod 600 .env.production
# Fill it in. Passwords and the auth secret: openssl rand -hex 24 / openssl rand -hex 32
mkdir -p secrets && cp /path/to/your-seal.p12 secrets/seal.p12
chmod 644 secrets/seal.p12   # the containers run as uid 1000
```

`BETTER_AUTH_URL` must be `https://` plus your domain, exactly as users reach it.

## 4. First start

```bash
docker compose -f compose.prod.yml --env-file .env.production build
# Let the app origin upload to the bucket (sets CORS for BETTER_AUTH_URL):
docker compose -f compose.prod.yml --env-file .env.production run --rm migrate npx tsx scripts/storage-init.mts
docker compose -f compose.prod.yml --env-file .env.production up -d
```

Staging without a CA certificate:

```bash
docker compose -f compose.prod.yml --env-file .env.production run --rm -v "$PWD/secrets:/app/.secrets" migrate npx tsx scripts/seal-dev-cert.mts
mv secrets/seal-dev.p12 secrets/seal.p12 && chmod 644 secrets/seal.p12   # put the printed password in SEAL_P12_PASSWORD
```

Check it:

```bash
curl -fsS https://<your domain>/api/health     # {"ok":true}
docker compose -f compose.prod.yml ps          # every service healthy
docker compose -f compose.prod.yml logs -f worker
```

Then sign up, create a workspace, and send yourself a test envelope. Download the signed PDF and open it in Adobe Reader: the signature panel should say the document has not been modified.

## 5. Updates

```bash
git pull
docker compose -f compose.prod.yml --env-file .env.production up -d --build
```

`migrate` runs first; web and worker start only if it succeeds. Old signing links, sessions and queued emails keep working across updates.

The images take a few GB (runtime, migrate and backup together). Reclaim space from old builds now and then with `docker image prune -f && docker builder prune -f`.

## 6. Backups and restore

- The `backup` service writes `stampd/stampd-<UTC time>Z.dump` to the backup bucket every day at `BACKUP_HOUR_UTC`. The dump is written to a file first and uploaded only if `pg_dump` succeeds.
- Take one now, and prove it restores (it loads the newest dump into a scratch database, counts rows, then drops it):
  ```bash
  docker compose -f compose.prod.yml --env-file .env.production run --rm backup once
  docker compose -f compose.prod.yml --env-file .env.production run --rm backup check
  ```
  Run `check` after setting up and then every few months.
- Full restore onto a fresh server (after steps 1-3, with the same passwords). Start only Postgres, stream the dump in from the backup bucket, then start the rest:
  ```bash
  docker compose -f compose.prod.yml --env-file .env.production up -d postgres
  docker compose -f compose.prod.yml --env-file .env.production run --rm backup restore stampd-<UTC time>Z.dump
  docker compose -f compose.prod.yml --env-file .env.production up -d
  ```
  Documents are not in the dump: keep the storage bucket (with versioning) or restore it separately.

## 7. Operations

- **Logs:** `docker compose -f compose.prod.yml logs -f web worker`. The worker logs one JSON line per action (emails sent, envelopes sealed, reminders, failures).
- **Health:** `web` checks `/api/health` (includes a database query); `worker` writes a heartbeat file every loop. `docker compose ps` shows both.
- **Stuck sealing:** the envelope page shows the error and a "Try again" button after three automatic attempts.
- **Email problems:** failed deliveries show on the envelope page with the SMTP error; senders can press "Resend".
- **Rate limits:** sign-in, sign-up and password-reset requests are limited per IP by the app (Caddy passes the client IP in `X-Forwarded-For`).
- **Certificate renewal:** replace `secrets/seal.p12` (and `SEAL_P12_PASSWORD`), then `docker compose -f compose.prod.yml --env-file .env.production up -d worker`.

## Behind a TLS-inspecting proxy

If `npm ci` fails during `docker build` because of a corporate proxy, pass its CA certificate as a build secret:

```bash
docker build --secret id=extra_ca,src=/path/to/proxy-ca.crt --target runtime -t stampd:latest .
```
