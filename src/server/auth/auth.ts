import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/server/db/client";
import { env } from "@/server/env";
import { queueAccountEmail } from "@/server/email/outbox";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // The worker sends it; the link lands on /reset-password?token=...
    sendResetPassword: ({ user, url }) => queueAccountEmail({ kind: "password_reset", toEmail: user.email, toName: user.name, data: { name: user.name, url } }),
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
  },
  plugins: [nextCookies()], // must stay last
});
