// Creates a user and a workspace where they are admin.
// Usage: npm run admin:create -- <email> "<name>" "<workspace>" [password]
import { randomBytes } from "node:crypto";
import { auth } from "../src/server/auth/auth";
import { createTenant } from "../src/server/tenants/service";

const [email, name, workspace, given] = process.argv.slice(2);
if (!email || !name || !workspace) {
  console.error('Usage: npm run admin:create -- <email> "<name>" "<workspace>" [password]');
  process.exit(1);
}

// No password given: make a strong one and show it once.
const password = given ?? randomBytes(12).toString("base64url");
const { user } = await auth.api.signUpEmail({ body: { email, name, password } });
const tenant = await createTenant({ userId: user.id, name: workspace });

console.log(`Admin created: ${user.email} in "${workspace}" (${tenant.slug})`);
if (!given) console.log(`Password: ${password}`);
process.exit(0);
