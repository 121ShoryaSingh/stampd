-- Tenant isolation. The app role (stampd_app) only sees rows allowed by the
-- transaction-local settings app.tenant_id / app.user_id / app.token_hash,
-- which src/server/db/context.ts sets for every transaction.

grant usage on schema public to stampd_app;
grant select, insert, update, delete on all tables in schema public to stampd_app;
grant usage, select on all sequences in schema public to stampd_app;
alter default privileges in schema public grant select, insert, update, delete on tables to stampd_app;
alter default privileges in schema public grant usage, select on sequences to stampd_app;

create or replace function app_tenant_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function app_user_id() returns text
language sql stable as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function app_token_hash() returns text
language sql stable as $$ select nullif(current_setting('app.token_hash', true), '') $$;

-- tenants: full access to the current tenant; read access to tenants the user belongs to.
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_isolation on tenants
  using (id = app_tenant_id()) with check (id = app_tenant_id());
create policy member_read on tenants for select
  using (exists (select 1 from memberships m where m.tenant_id = tenants.id and m.user_id = app_user_id()));

-- memberships: current tenant, plus the user's own rows (to list their workspaces).
alter table memberships enable row level security;
alter table memberships force row level security;
create policy tenant_isolation on memberships
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy own_read on memberships for select
  using (user_id = app_user_id());

-- invitations: current tenant, plus the single invitation matching a token hash.
alter table invitations enable row level security;
alter table invitations force row level security;
create policy tenant_isolation on invitations
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy token_read on invitations for select
  using (token_hash = app_token_hash());

-- envelope tables: current tenant only.
do $$
declare t text;
begin
  foreach t in array array['envelopes', 'documents', 'recipients', 'fields', 'audit_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- The audit log is append-only for the app.
revoke update, delete, truncate on audit_events from stampd_app;
