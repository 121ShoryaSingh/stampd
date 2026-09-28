import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  type CORSRule,
} from "@aws-sdk/client-s3";

// Makes sure the bucket exists and lets the app origin PUT/GET directly.
// Safe on shared buckets: existing CORS rules are kept, Stampd's rule is only added.
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const bucket = need("S3_BUCKET");
const origin = new URL(need("BETTER_AUTH_URL")).origin;
const s3 = new S3Client({
  region: need("S3_REGION"),
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } }
    : {}),
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`bucket ${bucket} exists`);
} catch (e) {
  // Only create when the bucket is really missing, never on a permissions error.
  if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw e;
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket ${bucket} created`);
}

let rules: CORSRule[] = [];
try {
  rules = (await s3.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? [];
} catch (e) {
  if ((e as { name?: string }).name !== "NoSuchCORSConfiguration") throw e;
}

const covered = rules.some(
  (r) => (r.AllowedOrigins ?? []).some((o) => o === origin || o === "*") && ["PUT", "GET"].every((m) => (r.AllowedMethods ?? []).includes(m)),
);
if (covered) {
  console.log(`CORS already allows ${origin} (${rules.length} rules kept)`);
} else {
  const ours: CORSRule = { AllowedOrigins: [origin], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 3600 };
  await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [...rules, ours] } }));
  console.log(`CORS rule added for ${origin} (${rules.length} existing rules kept)`);
}
