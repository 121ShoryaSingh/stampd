import "server-only";
import { createStorageAdapter, StorageOperationError } from "@khair/storage-adapter";
import { env } from "@/server/env";
import { NotFoundError } from "@/server/errors";

// Same adapter as POS and Horizon; static keys only when given, else the AWS default chain.
const adapter = createStorageAdapter({
  provider: "s3",
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : {}),
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
});

const notFound = (e: unknown) => e instanceof StorageOperationError && e.code === "NOT_FOUND";

export function presignUpload(key: string, contentType: string, expiresSec = 300): Promise<string> {
  return adapter.getSignedUploadUrl(key, { contentType, expiresInSeconds: expiresSec });
}

export function presignGet(key: string, expiresSec = 300): Promise<string> {
  return adapter.getSignedUrl(key, { expiresInSeconds: expiresSec });
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await adapter.download(key));
  } catch (e) {
    if (notFound(e)) throw new NotFoundError("File not found");
    throw e;
  }
}

export function objectExists(key: string): Promise<boolean> {
  return adapter.exists(key);
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await adapter.upload(key, body, { contentType });
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await adapter.delete(key);
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}
