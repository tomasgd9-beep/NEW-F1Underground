import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { ensureBootstrapCommissioner } from "@/lib/league";

function bootstrapEmails(): string[] {
  return (process.env.BOOTSTRAP_COMMISSIONER_EMAILS ?? "").split(",").filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const db = getDb();
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter: DrizzleAdapter(db as any, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: "database" },
    providers: [
      // Same email on Google and on an emailed link = the same account.
      Google({ allowDangerousEmailAccountLinking: true }),
      Nodemailer({
        server: process.env.EMAIL_SERVER ?? "smtp://localhost:25",
        from: process.env.EMAIL_FROM,
        // Without an email account (local development) the link is printed in the terminal.
        ...(process.env.EMAIL_SERVER
          ? {}
          : {
              sendVerificationRequest: async ({ identifier, url }: { identifier: string; url: string }) => {
                console.log(`\n[dev] Sign-in link for ${identifier}:\n${url}\n`);
              },
            }),
      }),
    ],
    pages: { signIn: "/signin", verifyRequest: "/signin/check-email", error: "/signin" },
    events: {
      async signIn({ user }) {
        if (user.id) await ensureBootstrapCommissioner(db, { ...user, id: user.id }, bootstrapEmails());
      },
    },
  };
});
