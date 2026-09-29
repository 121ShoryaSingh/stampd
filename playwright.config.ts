import { defineConfig } from "@playwright/test";
import { selfSignedSealP12 } from "./src/server/finalize/dev-cert";

// E2E gets its own server on 3101 backed by local RustFS, so tests never write to the real R2 bucket.
const PORT = 3101;
// Set E2E_BASE_URL to test against an already running server (Next allows one dev server per folder).
const EXTERNAL = process.env.E2E_BASE_URL;
const testEnv = {
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
  S3_ENDPOINT: "http://localhost:9100",
  S3_REGION: "us-east-1",
  S3_BUCKET: "stampd-dev",
  S3_PREFIX: "e2e/",
  S3_ACCESS_KEY: "stampd",
  S3_SECRET_KEY: "stampd-s3-secret",
  // Mailpit from compose.dev.yml; tests read links and codes from its API.
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_USER: "",
  SMTP_PASS: "",
  EMAIL_FROM_ADDRESS: "no-reply@stampd.test",
  // A throwaway seal certificate for the e2e worker.
  SEAL_P12_PATH: "",
  SEAL_P12_BASE64: selfSignedSealP12({ commonName: "Stampd E2E Seal", password: "e2e" }).toString("base64"),
  SEAL_P12_PASSWORD: "e2e",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // Dev server compiles routes on first hit; keep parallelism and waits realistic for that.
  workers: 2,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: EXTERNAL ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: EXTERNAL
    ? undefined
    : [
        {
          command: `npx next dev -p ${PORT}`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: testEnv,
        },
        // Sends the emails the tests wait for. Stop any dev worker first: it would send e2e mail with dev links.
        {
          command: "npm run worker",
          wait: { stdout: /worker started/ },
          reuseExistingServer: false,
          timeout: 60_000,
          env: testEnv,
        },
      ],
});

export { testEnv };
