-- Idempotent: runs after every migration.
grant usage on schema public to stampd_app;
grant select, insert, update, delete on all tables in schema public to stampd_app;
grant usage, select on all sequences in schema public to stampd_app;
alter default privileges in schema public grant select, insert, update, delete on tables to stampd_app;
alter default privileges in schema public grant usage, select on sequences to stampd_app;

create or replace function app_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

alter table tenants enable row level security;
alter table tenants force row level security;
drop policy if exists tenant_isolation on tenants;
create policy tenant_isolation on tenants
  using (id = app_tenant_id()) with check (id = app_tenant_id());

alter table memberships enable row level security;
alter table memberships force row level security;
drop policy if exists tenant_isolation on memberships;
create policy tenant_isolation on memberships
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

alter table invitations enable row level security;
alter table invitations force row level security;
drop policy if exists tenant_isolation on invitations;
create policy tenant_isolation on invitations
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- Cross-tenant lookups. Owned by the migrator (BYPASSRLS), return only these columns.
create or replace function user_tenants(p_user_id text)
returns table (tenant_id uuid, name text, slug text, role text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, m.role::text
  from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
  order by t.created_at
$$;
revoke all on function user_tenants(text) from public;
grant execute on function user_tenants(text) to stampd_app;

create or replace function resolve_invitation(p_token_hash text)
returns table (tenant_id uuid, invitation_id uuid)
language sql stable security definer set search_path = public as $$
  select i.tenant_id, i.id from invitations i
  where i.token_hash = p_token_hash and i.accepted_at is null and i.expires_at > now()
$$;
revoke all on function resolve_invitation(text) from public;
grant execute on function resolve_invitation(text) to stampd_app;
