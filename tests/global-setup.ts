import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import type { TestProject } from "vitest/node";
import { execSync } from "node:child_process";
import pg from "pg";

let db: StartedPostgreSqlContainer | undefined;
let s3c: StartedTestContainer | undefined;
let mail: StartedTestContainer | undefined;

export default async function setup(project: TestProject) {
  [db, s3c, mail] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine").start(),
    new GenericContainer("rustfs/rustfs:latest")
      .withEnvironment({ RUSTFS_ACCESS_KEY: "test", RUSTFS_SECRET_KEY: "test-secret-123" })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/health", 9000))
      .start(),
    new GenericContainer("axllent/mailpit:latest")
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp("/readyz", 8025))
      .start(),
  ]);

  // Roles and database mirror docker/postgres/init.sql (Prisma cannot create roles).
  const admin = new pg.Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  await admin.query("create role stampd_migrator login password 'migrator' bypassrls createdb");
  await admin.query("create role stampd_app login password 'app'");
  await admin.query("create database stampd_test owner stampd_migrator");
  await admin.end();

  const base = `${db.getHost()}:${db.getPort()}/stampd_test`;
  const migratorUrl = `postgres://stampd_migrator:migrator@${base}`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, MIGRATOR_DATABASE_URL: migratorUrl }, stdio: "pipe" });

  const s3Url = `http://${s3c.getHost()}:${s3c.getMappedPort(9000)}`;
  const s3 = new S3Client({ endpoint: s3Url, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test-secret-123" } });
  await s3.send(new CreateBucketCommand({ Bucket: "stampd-test" }));

  project.provide("appDbUrl", `postgres://stampd_app:app@${base}`);
  project.provide("migratorDbUrl", migratorUrl);
  project.provide("s3Url", s3Url);
  project.provide("smtpHost", mail.getHost());
  project.provide("smtpPort", mail.getMappedPort(1025));
  project.provide("mailpitUrl", `http://${mail.getHost()}:${mail.getMappedPort(8025)}`);

  return async () => {
    await Promise.all([db?.stop(), s3c?.stop(), mail?.stop()]);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    appDbUrl: string;
    migratorDbUrl: string;
    s3Url: string;
    smtpHost: string;
    smtpPort: number;
    mailpitUrl: string;
  }
}
