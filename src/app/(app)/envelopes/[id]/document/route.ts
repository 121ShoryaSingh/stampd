import { NextResponse } from "next/server";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";

// Mints a fresh short-lived link on every click, so pages never hold an expired URL.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireTenant();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const { document } = await getEnvelope(tenant.tenantId, id);
    if (!document) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(await presignGet(document.s3Key, 300));
  } catch (e) {
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
