import { ValidationError } from "@/server/errors";

const PREFIX = "data:image/png;base64,";
const MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Turns a PNG data URL from the signature pad into bytes, or rejects it.
export function decodePng(dataUrl: string, maxBytes = 300_000): Uint8Array {
  if (!dataUrl.startsWith(PREFIX)) throw new ValidationError("Signatures must be PNG images");
  const bytes = new Uint8Array(Buffer.from(dataUrl.slice(PREFIX.length), "base64"));
  if (bytes.length < MAGIC.length || MAGIC.some((b, i) => bytes[i] !== b)) throw new ValidationError("Signatures must be PNG images");
  if (bytes.length > maxBytes) throw new ValidationError("The signature image is too large");
  return bytes;
}
