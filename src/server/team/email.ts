import { z } from "zod";
import { ValidationError } from "@/server/errors";

const Email = z.string().email().max(254);

export function normalizeEmail(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!Email.safeParse(v).success) throw new ValidationError("Enter a valid email address");
  return v;
}
