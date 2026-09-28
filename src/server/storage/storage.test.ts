import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { presignUpload, presignGet, getObjectBytes, objectExists, putObject, deleteObject } from "./storage";
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

  it("throws NotFoundError for a missing key", async () => {
    await expect(getObjectBytes(key())).rejects.toBeInstanceOf(NotFoundError);
  });
});
