import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { PlainShell } from "@/components/plain-shell";
import { CodeForm } from "@/components/code-form";
import { requireViewer, viewerPendingClaim } from "@/lib/session";
import { withdrawClaim } from "@/app/actions";

export const dynamic = "force-dynamic";

/** Signed in, not in a league yet: join one with a code. */
export default async function Welcome() {
  const v = await requireViewer();
  if (v.player?.active) redirect("/team");
  const claim = await viewerPendingClaim(v.userId);
  const first = v.name?.split(" ")[0];

  return (
    <PlainShell>
      {v.player && !v.player.active ? (
        <>
          <h1 className="text-lg font-bold">Your profile is inactive</h1>
          <p className="text-sm text-muted">Ask a commissioner to reactivate {v.player.displayName}.</p>
        </>
      ) : claim ? (
        <>
          <h1 className="text-lg font-bold">Almost there</h1>
          <p className="text-sm text-muted">
            You asked to join as <b className="text-ink">{claim.displayName}</b>. A commissioner needs to confirm
            it&apos;s you; this page opens the league once they have.
          </p>
          <form action={withdrawClaim} className="mt-3">
            <button className="text-sm text-muted underline">Picked the wrong name? Cancel the request</button>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-lg font-bold">Welcome{first ? `, ${first}` : ""}!</h1>
          <p className="text-sm text-muted">Enter your league&apos;s code to join it.</p>
          <div className="mt-3">
            <CodeForm autoFocus />
          </div>
          <p className="mt-3 text-xs text-muted">
            Got a link or an email invite instead? Just open it. No code? Ask your league&apos;s commissioner.
          </p>
        </>
      )}
      <form
        className="mt-5 border-t border-line pt-3"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button className="text-xs text-muted underline">Signed in as {v.email}. Not you? Sign out</button>
      </form>
    </PlainShell>
  );
}
