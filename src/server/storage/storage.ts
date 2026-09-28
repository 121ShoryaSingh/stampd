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

// Stampd's folder inside a shared bucket; app code and the database never see it.
const full = (key: string) => `${env.S3_PREFIX ?? ""}${key}`;
const notFound = (e: unknown) => e instanceof StorageOperationError && e.code === "NOT_FOUND";

export function presignUpload(key: string, contentType: string, expiresSec = 300): Promise<string> {
  return adapter.getSignedUploadUrl(full(key), { contentType, expiresInSeconds: expiresSec });
}

export function presignGet(key: string, expiresSec = 300): Promise<string> {
  return adapter.getSignedUrl(full(key), { expiresInSeconds: expiresSec });
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await adapter.download(full(key)));
  } catch (e) {
    if (notFound(e)) throw new NotFoundError("File not found");
    throw e;
  }
}

export function objectExists(key: string): Promise<boolean> {
  return adapter.exists(full(key));
}

// Size from a listing, so nothing is downloaded; null if missing.
export async function objectSize(key: string): Promise<number | null> {
  const hit = (await adapter.list(full(key))).find((o) => o.key === full(key));
  return hit ? hit.size : null;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await adapter.upload(full(key), body, { contentType });
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await adapter.delete(full(key));
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}
