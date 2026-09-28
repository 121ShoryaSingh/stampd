import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import postgres from "postgres";
import { runMigrations } from "../src/server/db/migrate";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

let container: StartedPostgreSqlContainer | undefined;
let s3c: StartedTestContainer | undefined;

export default async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create role stampd_migrator login password 'migrator' bypassrls; create role stampd_app login password 'app';`);
  await admin.unsafe(`create database stampd_test owner stampd_migrator`);
  await admin.end();

  const base = `${container.getHost()}:${container.getPort()}/stampd_test`;
  const migratorUrl = `postgres://stampd_migrator:migrator@${base}`;
  await runMigrations(migratorUrl);

  s3c = await new GenericContainer("rustfs/rustfs:latest")
    .withEnvironment({ RUSTFS_ACCESS_KEY: "test", RUSTFS_SECRET_KEY: "test-secret-123" })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/health", 9000))
    .start();
  const s3Url = `http://${s3c.getHost()}:${s3c.getMappedPort(9000)}`;
  const s3 = new S3Client({ endpoint: s3Url, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test-secret-123" } });
  await s3.send(new CreateBucketCommand({ Bucket: "stampd-test" }));
  project.provide("s3Url", s3Url);

  project.provide("appDbUrl", `postgres://stampd_app:app@${base}`);
  project.provide("migratorDbUrl", migratorUrl);

  return async () => {
    await Promise.all([container?.stop(), s3c?.stop()]);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    appDbUrl: string;
    migratorDbUrl: string;
    s3Url: string;
  }
}
