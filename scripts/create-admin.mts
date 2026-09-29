// Creates a user and a workspace where they are admin, or resets the password if the user exists.
// Usage: npm run admin:create -- <email> "<name>" "<workspace>" [password]
import { auth } from "../src/server/auth/auth";
import { prisma } from "../src/server/db/client";
import { createTenant } from "../src/server/tenants/service";

// Dev only: a simple default password.
const DEFAULT_PASSWORD = "Admin@12345";

const [email, name, workspace, given] = process.argv.slice(2);
if (!email || !name || !workspace) {
  console.error('Usage: npm run admin:create -- <email> "<name>" "<workspace>" [password]');
  process.exit(1);
}
const password = given ?? DEFAULT_PASSWORD;

const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
if (existing) {
  const hash = await (await auth.$context).password.hash(password);
  await prisma.account.updateMany({ where: { userId: existing.id, providerId: "credential" }, data: { password: hash } });
  console.log(`Password reset for ${existing.email}`);
} else {
  const { user } = await auth.api.signUpEmail({ body: { email, name, password } });
  const tenant = await createTenant({ userId: user.id, name: workspace });
  console.log(`Admin created: ${user.email} in "${workspace}" (${tenant.slug})`);
}
process.exit(0);
