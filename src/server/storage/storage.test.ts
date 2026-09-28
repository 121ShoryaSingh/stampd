import { describe, it, expect, inject } from "vitest";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { presignUpload, presignGet, getObjectBytes, objectExists, objectSize, putObject, deleteObject } from "./storage";
import { NotFoundError } from "@/server/errors";

const key = () => `t/test/e/test/${randomUUID()}.pdf`;

describe("storage", () => {
  it("round-trips an object via presigned PUT and GET", async () => {
    const k = key();
    const url = await presignUpload(k, "application/pdf");
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: "%PDF-hello" });
    expect(put.status).toBe(200);
    expect(new TextDecoder().decode(await getObjectBytes(k))).toBe("%PDF-hello");
    expect(await (await fetch(await presignGet(k))).text()).toBe("%PDF-hello");
  });

  it("reports existence and deletes", async () => {
    const k = key();
    expect(await objectExists(k)).toBe(false);
    await putObject(k, new Uint8Array([1, 2]), "application/pdf");
    expect(await objectExists(k)).toBe(true);
    await deleteObject(k);
    expect(await objectExists(k)).toBe(false);
    await expect(deleteObject(k)).resolves.toBeUndefined();
  });

  it("reports object size without downloading, null when missing", async () => {
    const k = key();
    await putObject(k, new Uint8Array(1234), "application/pdf");
    expect(await objectSize(k)).toBe(1234);
    expect(await objectSize(key())).toBeNull();
  });

  it("stores every object under the S3_PREFIX folder", async () => {
    const k = key();
    await putObject(k, new Uint8Array([7]), "application/pdf");
    const raw = new S3Client({ endpoint: inject("s3Url"), region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test-secret-123" } });
    await expect(raw.send(new HeadObjectCommand({ Bucket: "stampd-test", Key: `stampd-test/${k}` }))).resolves.toBeTruthy();
    await expect(raw.send(new HeadObjectCommand({ Bucket: "stampd-test", Key: k }))).rejects.toThrow();
  });

  it("throws NotFoundError for a missing key", async () => {
    await expect(getObjectBytes(key())).rejects.toBeInstanceOf(NotFoundError);
  });
});
