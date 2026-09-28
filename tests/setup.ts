import { inject } from "vitest";

process.env.DATABASE_URL = inject("appDbUrl");
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.S3_ENDPOINT = inject("s3Url");
process.env.S3_REGION = "us-east-1";
process.env.S3_BUCKET = "stampd-test";
process.env.S3_ACCESS_KEY = "test";
process.env.S3_SECRET_KEY = "test-secret-123";
process.env.S3_PREFIX = "stampd-test/";
