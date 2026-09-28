import "server-only";
import { z } from "zod";

// Empty strings in .env files mean "not set".
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t.optional());

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  S3_BUCKET: z.string().min(3),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(), // RustFS / R2; leave unset for AWS S3
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_PREFIX: z.string().regex(/^[a-z0-9-]+\/$/, "S3_PREFIX must look like 'stampd/'").optional(), // folder in a shared bucket
  // Email: only the worker sends, so the web app starts without these.
  SMTP_HOST: opt(z.string().min(1)),
  SMTP_PORT: opt(z.coerce.number().int().min(1).max(65535)),
  SMTP_USER: opt(z.string().min(1)),
  SMTP_PASS: opt(z.string().min(1)),
  EMAIL_FROM_NAME: opt(z.string().min(1).max(100)),
  EMAIL_FROM_ADDRESS: opt(z.string().email()),
});

export const env = schema.parse(process.env);
