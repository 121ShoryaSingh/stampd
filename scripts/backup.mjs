// Database backups to S3-compatible storage, run by the `backup` container (see DEPLOY.md).
//   node scripts/backup.mjs daily            every day at BACKUP_HOUR_UTC (default 2)
//   node scripts/backup.mjs once             one backup now
//   node scripts/backup.mjs check            restore the newest backup into a scratch database, count rows, drop it
//   node scripts/backup.mjs restore <file>   restore a backup into the live database (fresh server only)
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`backup: set ${name}`);
    process.exit(2);
  }
  return v;
}

const PGURL = need("PGURL");
const BUCKET = need("BACKUP_S3_BUCKET");
const PREFIX = (process.env.BACKUP_S3_PREFIX || "stampd").replace(/\/+$/, "");
const s3 = new S3Client({
  region: process.env.BACKUP_S3_REGION || "auto",
  endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
  forcePathStyle: !!process.env.BACKUP_S3_ENDPOINT,
  credentials: { accessKeyId: need("BACKUP_S3_ACCESS_KEY"), secretAccessKey: need("BACKUP_S3_SECRET_KEY") },
  // Some S3-compatible stores reject the newer default checksums.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const log = (msg) => console.log(`${new Date().toISOString()} backup: ${msg}`);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

// Same server and credentials, another database.
function withDatabase(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function download(key, file) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(res.Body, createWriteStream(file));
}

export async function once() {
  const key = `${PREFIX}/stampd-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z.dump`;
  const file = "/tmp/stampd-backup.dump";
  // Dump to a file first, so a failed dump never uploads a truncated backup.
  await run("pg_dump", ["-Fc", "--no-owner", "-f", file, PGURL]);
  const { size } = await stat(file);
  await new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: createReadStream(file), ContentType: "application/octet-stream" } }).done();
  await rm(file, { force: true });
  log(`wrote s3://${BUCKET}/${key} (${size} bytes)`);
  return key;
}

async function newest() {
  let token;
  let best;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/`, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key.endsWith(".dump") && (!best || o.Key > best)) best = o.Key;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  if (!best) throw new Error(`no backups under s3://${BUCKET}/${PREFIX}/`);
  return best;
}

export async function check() {
  const key = await newest();
  const file = "/tmp/stampd-check.dump";
  log(`checking ${key}`);
  await download(key, file);
  const admin = withDatabase(PGURL, "postgres");
  const scratch = withDatabase(PGURL, "stampd_restore_check");
  await run("psql", [admin, "-v", "ON_ERROR_STOP=1", "-c", "drop database if exists stampd_restore_check", "-c", "create database stampd_restore_check"]);
  try {
    await run("pg_restore", ["--no-owner", "--exit-on-error", "-d", scratch, file]);
    await run("psql", [scratch, "-At", "-c", "select 'tenants=' || count(*) from tenants union all select 'envelopes=' || count(*) from envelopes union all select 'audit_events=' || count(*) from audit_events"]);
  } finally {
    await run("psql", [admin, "-v", "ON_ERROR_STOP=1", "-c", "drop database if exists stampd_restore_check"]);
    await rm(file, { force: true });
  }
  log(`restore check passed for ${key}`);
}

async function restore(name) {
  if (!name) throw new Error("usage: restore <file name in the backup bucket>");
  const file = "/tmp/stampd-restore.dump";
  await download(`${PREFIX}/${name}`, file);
  log(`restoring ${name} into the live database`);
  await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--exit-on-error", "-d", PGURL, file]);
  await rm(file, { force: true });
  log("restore done");
}

async function daily() {
  const hour = Number(process.env.BACKUP_HOUR_UTC ?? 2);
  for (;;) {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    log(`next backup at ${next.toISOString()}`);
    await new Promise((r) => setTimeout(r, next.getTime() - now.getTime()));
    try {
      await once();
    } catch (e) {
      log(`FAILED: ${e instanceof Error ? e.message : e}; next try tomorrow`);
    }
  }
}

const [cmd = "daily", arg] = process.argv.slice(2);
const actions = { once, check, restore: () => restore(arg), daily };
if (!actions[cmd]) {
  console.error("usage: node scripts/backup.mjs [daily|once|check|restore <file>]");
  process.exit(2);
}
actions[cmd]().catch((e) => {
  log(`FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
