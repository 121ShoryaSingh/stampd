-- AlterTable
ALTER TABLE "email_jobs" ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "envelope_id" DROP NOT NULL;

-- An envelope email always belongs to a workspace.
alter table email_jobs add constraint email_jobs_envelope_has_tenant check (envelope_id is null or tenant_id is not null);

-- Account emails (no workspace): the app may queue them; only the worker reads and updates them.
create policy system_insert on email_jobs for insert
  with check (tenant_id is null and envelope_id is null);
create policy system_update on email_jobs for update
  using (tenant_id is null and app_worker()) with check (tenant_id is null and envelope_id is null);
