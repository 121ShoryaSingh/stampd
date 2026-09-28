import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import postgres from "postgres";
import { runMigrations } from "../src/server/db/migrate";

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create role stampd_migrator login password 'migrator' bypassrls; create role stampd_app login password 'app';`);
  await admin.unsafe(`create database stampd_test owner stampd_migrator`);
  await admin.end();

  const base = `${container.getHost()}:${container.getPort()}/stampd_test`;
  const migratorUrl = `postgres://stampd_migrator:migrator@${base}`;
  await runMigrations(migratorUrl);

  project.provide("appDbUrl", `postgres://stampd_app:app@${base}`);
  project.provide("migratorDbUrl", migratorUrl);

  return async () => {
    await container?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    appDbUrl: string;
    migratorDbUrl: string;
  }
}
