import { defineConfig } from "@playwright/test";

// E2E gets its own server on 3101 backed by local RustFS, so tests never write to the real R2 bucket.
const PORT = 3101;
const testEnv = {
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
  S3_ENDPOINT: "http://localhost:9100",
  S3_REGION: "us-east-1",
  S3_BUCKET: "stampd-dev",
  S3_PREFIX: "e2e/",
  S3_ACCESS_KEY: "stampd",
  S3_SECRET_KEY: "stampd-s3-secret",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // Dev server compiles routes on first hit; keep parallelism and waits realistic for that.
  workers: 2,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: testEnv,
  },
});

export { testEnv };
