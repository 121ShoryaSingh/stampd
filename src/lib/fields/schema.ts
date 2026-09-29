import { z } from "zod";
import { CHOICE_MARKS, MAX_LABEL, MAX_OPTION } from "./choice";

// A field as the editor sends it; "recipientId" is the assignee (a recipient, or a preset role).
export const EditorFieldSchema = z.object({
  recipientId: z.string().uuid(),
  type: z.enum(["signature", "initials", "date", "text", "checkbox", "choice"]),
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  required: z.boolean().optional(),
  label: z.string().max(MAX_LABEL * 2).nullable().optional(),
  groupKey: z.string().max(64).nullable().optional(),
  option: z.string().max(MAX_OPTION * 2).nullable().optional(),
  mark: z.enum(CHOICE_MARKS).nullable().optional(),
});
