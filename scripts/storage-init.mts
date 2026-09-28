import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";

// Creates the bucket if missing and lets the app origin PUT/GET directly. Works for RustFS and R2.
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
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket ${bucket} created`);
}

await s3.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [{ AllowedOrigins: [origin], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 3600 }],
    },
  }),
);
console.log(`CORS allows ${origin}`);
