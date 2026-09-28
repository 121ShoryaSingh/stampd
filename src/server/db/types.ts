export type {
  MembershipRole as Role,
  EnvelopeStatus,
  RecipientRole,
  RecipientStatus,
  FieldType,
  ActorType,
} from "@/generated/prisma/enums";

// Visible page size in PDF points; rotate is the page /Rotate in degrees.
export type PageSize = { w: number; h: number; rotate: number };
