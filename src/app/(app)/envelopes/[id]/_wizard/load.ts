import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { NotFoundError } from "@/server/errors";
import { firstOpenStep, progress, reachable, stepHref, type StepKey } from "./steps";

// Loads a draft for a wizard step; sent envelopes go to their status page, locked steps to the first open one.
export async function loadStep(id: string, step: StepKey) {
  const { session, tenant } = await requireTenant();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getEnvelope(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (data.envelope.status !== "draft") redirect(`/envelopes/${id}`);
  const done = progress(data);
  if (!reachable(step, done)) redirect(stepHref(id, firstOpenStep(done)));
  return { session, tenant, data, done };
}
