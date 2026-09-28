import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Local dev reads .env.local; tests and CI pass MIGRATOR_DATABASE_URL directly.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("MIGRATOR_DATABASE_URL") },
});
