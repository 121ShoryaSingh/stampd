import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { createUploadUrl } from "@/server/envelopes/service";
import { DomainError } from "@/server/errors";

export async function POST(req: Request) {
  const { tenant } = await requireTenant();
  const body = z.object({ envelopeId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    return NextResponse.json(await createUploadUrl({ tenantId: tenant.tenantId, envelopeId: body.data.envelopeId }));
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
