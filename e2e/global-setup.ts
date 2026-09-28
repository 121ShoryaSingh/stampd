import { execSync } from "node:child_process";
import { testEnv } from "../playwright.config";

const WARM = ["/signup", "/login", "/onboarding", "/dashboard", "/envelopes/new", "/settings/team", "/api/auth/get-session", "/sign/warmup-token-warmup-token"];

export default async function setup() {
  // Lets the e2e origin upload to local RustFS (adds a CORS rule, keeps existing ones).
  execSync("npx tsx --env-file=.env.local scripts/storage-init.mts", { env: { ...process.env, ...testEnv }, stdio: "inherit" });
  // Compile the main routes once so the first tests do not race the dev compiler.
  for (const path of WARM) await fetch(`${testEnv.BETTER_AUTH_URL}${path}`, { redirect: "manual" }).catch(() => {});
}
