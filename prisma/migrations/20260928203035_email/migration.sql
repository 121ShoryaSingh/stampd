-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('queued', 'sent', 'failed');

-- AlterTable
ALTER TABLE "recipients" ADD COLUMN     "invited_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "envelope_id" UUID NOT NULL,
    "recipient_id" UUID,
    "kind" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "to_name" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "email_status" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_jobs_status_run_at_idx" ON "email_jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "email_jobs_envelope_id_idx" ON "email_jobs"("envelope_id");

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_envelope_id_fkey" FOREIGN KEY ("envelope_id") REFERENCES "envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation for the outbox, like every envelope table.
alter table email_jobs enable row level security;
alter table email_jobs force row level security;
create policy tenant_isolation on email_jobs
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- The worker finds work across tenants (read only); it writes through tenant context.
create or replace function app_worker() returns boolean
language sql stable as $$ select coalesce(current_setting('app.worker', true), '') = 'on' $$;

create policy worker_read on email_jobs for select using (app_worker());
create policy worker_read on envelopes for select using (app_worker());
create policy worker_read on recipients for select using (app_worker());
