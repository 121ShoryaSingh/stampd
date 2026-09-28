import { execSync } from "node:child_process";
import { testEnv } from "../playwright.config";

// Lets the e2e origin upload to local RustFS (adds a CORS rule, keeps existing ones).
export default function setup() {
  execSync("npx tsx --env-file=.env.local scripts/storage-init.mts", { env: { ...process.env, ...testEnv }, stdio: "inherit" });
}
