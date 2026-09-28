import { runMigrations } from "../src/server/db/migrate.ts";

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error("MIGRATOR_DATABASE_URL is not set");
await runMigrations(url);
console.log("migrations applied");
