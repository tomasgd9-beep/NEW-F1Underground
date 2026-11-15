import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { PlainShell } from "@/components/plain-shell";
import { demoMode } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** Only same-site paths are allowed as a return address. */
function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const to = safeNext(next);
  const session = await auth();
  if (session?.user) redirect(to);

  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Sign in</h1>
      <p className="text-sm text-muted">No passwords: use Google or get a sign-in link by email.</p>
      {demoMode() && (
        <a href="/dev-login" className="mt-3 block rounded bg-red/10 px-3 py-2 text-sm font-semibold text-red">
          Local demo: skip sign-in and pick a demo player →
        </a>
      )}
      {error && <p className="mt-2 text-sm text-down">Sign-in didn&apos;t work. Try again.</p>}

      <form
        className="mt-4"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: to });
        }}
      >
        <button className="w-full rounded bg-navy text-white py-2 font-semibold hover:brightness-125">
          Continue with Google
        </button>
      </form>

      <div className="my-4 flex items-center gap-2 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        className="flex gap-2"
        action={async (form: FormData) => {
          "use server";
          try {
            await signIn("nodemailer", { email: String(form.get("email") ?? ""), redirectTo: to, redirect: false });
          } catch (e) {
            if (e instanceof AuthError) redirect(`/signin?error=1&next=${encodeURIComponent(to)}`);
            throw e;
          }
          redirect("/signin/check-email");
        }}
      >
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1.5"
        />
        <button className="rounded bg-red px-3 font-semibold text-white">Email me a link</button>
      </form>
    </PlainShell>
  );
}
