// Background worker: seals completed envelopes, sends queued email, and runs the reminder and expiry ticks.
// Run with `npm run worker` (dev) next to `npm run dev`.
import { prisma } from "@/server/db/client";
import { emailConfigured } from "@/server/email/mailer";
import { processDueEmails } from "@/server/email/outbox";
import { processDueFinalizations, sealConfigured, sealKey } from "@/server/finalize/service";
import { expireDue, remindDue } from "@/server/jobs/ticks";

const EMAIL_EVERY_MS = 2_000;
const TICK_EVERY_MS = 300_000;

let stopping = false;
let wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise<void>((r) => ((wake = r), setTimeout(r, ms)));
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

// One failing iteration is logged and retried next round; it never stops the loop.
async function safely(name: string, fn: () => Promise<Record<string, number>>) {
  try {
    const res = await fn();
    if (Object.values(res).some((n) => n > 0)) log(name, res);
  } catch (e) {
    log(`${name} failed`, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function main() {
  if (!emailConfigured()) {
    console.error("Worker needs SMTP_HOST and EMAIL_FROM_ADDRESS (see .env.example).");
    process.exit(1);
  }
  // Email still flows without a seal certificate; envelopes then show the sealing error.
  if (!sealConfigured()) log("sealing is not configured: set SEAL_P12_PATH or SEAL_P12_BASE64");
  else sealKey(); // fail fast on a wrong password or file
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      log("stopping", { signal: sig });
      stopping = true;
      wake?.();
    });
  }
  log("worker started");
  let nextTick = 0;
  while (!stopping) {
    if (Date.now() >= nextTick) {
      await safely("expire", () => expireDue());
      await safely("remind", () => remindDue());
      nextTick = Date.now() + TICK_EVERY_MS;
    }
    await safely("seal", () => processDueFinalizations());
    await safely("email", () => processDueEmails());
    if (!stopping) await sleep(EMAIL_EVERY_MS);
  }
  await prisma.$disconnect();
  log("worker stopped");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
