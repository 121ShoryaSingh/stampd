import "server-only";
import { z } from "zod";

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
});

export const env = schema.parse(process.env);
