import { inject } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

// BYPASSRLS connection for seeding and asserting. Close with `await sql.end()`.
export function migratorSql() {
  return postgres(inject("migratorDbUrl"), { max: 2, onnotice: () => {} });
}

export async function insertUser(sql: ReturnType<typeof migratorSql>, email = `u-${randomUUID()}@test.dev`) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email) values (${id}, ${"Test " + id.slice(0, 4)}, ${email})`;
  return { id, email };
}

export async function insertTenant(sql: ReturnType<typeof migratorSql>, name = "Acme") {
  const [row] = await sql<{ id: string }[]>`
    insert into tenants (id, name, slug) values (gen_random_uuid(), ${name}, ${name.toLowerCase() + "-" + randomUUID().slice(0, 6)})
    returning id`;
  return row.id;
}
