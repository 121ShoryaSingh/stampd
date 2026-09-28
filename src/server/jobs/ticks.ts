import "server-only";
import { withDb, withTenant } from "@/server/db/context";
import { appendAudit } from "@/server/audit/service";
import { enqueueEmail } from "@/server/email/outbox";
import { lockEnvelope } from "@/server/envelopes/service";
import { envelopeUrl, issueLink, senderOf } from "@/server/envelopes/links";

const DAY = 86_400_000;
type TickOptions = { now?: Date; tenantId?: string }; // tenantId narrows a run (tests, manual runs)

const scope = (o: TickOptions) => (o.tenantId ? { tenantId: o.tenantId } : {});

function reminderDue(r: { invitedAt: Date | null; lastRemindedAt: Date | null }, everyDays: number | null, now: Date) {
  const since = r.lastRemindedAt ?? r.invitedAt;
  return !!everyDays && !!since && since.getTime() <= now.getTime() - everyDays * DAY;
}

// Emails a fresh link to active signers who have waited reminderEveryDays since their last email.
export async function remindDue(o: TickOptions = {}) {
  const now = o.now ?? new Date();
  const candidates = await withDb({ worker: true }, (tx) =>
    tx.recipient.findMany({
      where: {
        ...scope(o),
        role: "signer",
        status: { in: ["sent", "viewed"] },
        invitedAt: { not: null },
        envelope: { status: "sent", reminderEveryDays: { not: null }, expiresAt: { gt: now } },
      },
      select: { id: true, tenantId: true, envelopeId: true, invitedAt: true, lastRemindedAt: true, envelope: { select: { reminderEveryDays: true } } },
      take: 500,
    }),
  );
  let reminded = 0;
  for (const c of candidates.filter((c) => reminderDue(c, c.envelope.reminderEveryDays, now))) {
    const done = await withTenant(c.tenantId, async (tx) => {
      // Re-check under the envelope lock: another worker may have just reminded, or the state changed.
      const env = await lockEnvelope(tx, c.envelopeId);
      const rec = await tx.recipient.findUniqueOrThrow({ where: { id: c.id } });
      const open = env.status === "sent" && !!env.expiresAt && env.expiresAt > now && (rec.status === "sent" || rec.status === "viewed");
      if (!open || !reminderDue(rec, env.reminderEveryDays, now)) return false;
      await issueLink(tx, env, rec, "reminder", now);
      await appendAudit(tx, { tenantId: c.tenantId, envelopeId: c.envelopeId, actorType: "system", event: "reminded", data: { to: rec.email } });
      return true;
    });
    if (done) reminded++;
  }
  return { reminded };
}

// Marks sent envelopes past their expiry as expired and tells the sender.
export async function expireDue(o: TickOptions = {}) {
  const now = o.now ?? new Date();
  const due = await withDb({ worker: true }, (tx) =>
    tx.envelope.findMany({ where: { ...scope(o), status: "sent", expiresAt: { lte: now } }, select: { id: true, tenantId: true }, take: 500 }),
  );
  let expired = 0;
  for (const d of due) {
    const done = await withTenant(d.tenantId, async (tx) => {
      const env = await lockEnvelope(tx, d.id);
      if (env.status !== "sent" || !env.expiresAt || env.expiresAt > now) return false;
      await tx.envelope.update({ where: { id: env.id }, data: { status: "expired" } });
      await appendAudit(tx, { tenantId: env.tenantId, envelopeId: env.id, actorType: "system", event: "expired" });
      const sender = await senderOf(tx, env);
      await enqueueEmail(tx, {
        tenantId: env.tenantId,
        envelopeId: env.id,
        kind: "expired",
        toEmail: sender.email,
        toName: sender.name,
        data: { title: env.title, envelopeUrl: envelopeUrl(env.id) },
      });
      return true;
    });
    if (done) expired++;
  }
  return { expired };
}
