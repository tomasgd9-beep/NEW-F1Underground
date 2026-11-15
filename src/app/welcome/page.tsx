import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { PlainShell } from "@/components/plain-shell";
import { requireViewer, viewerPendingClaim } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Signed in, but not (yet) a league member. */
export default async function Welcome() {
  const v = await requireViewer();
  if (v.player?.active) redirect("/team");
  const claim = await viewerPendingClaim(v.userId);

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
            You asked to be linked to <b className="text-ink">{claim.displayName}</b>. A commissioner needs to confirm
            it; refresh this page once they have.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-bold">You&apos;re not in the league yet</h1>
          <p className="text-sm text-muted">
            Ask any member for the join link (it&apos;s usually in the group chat), or for an email invite to{" "}
            <b className="text-ink">{v.email}</b>.
          </p>
        </>
      )}
      <form
        className="mt-4"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button className="text-sm text-muted underline">Sign out</button>
      </form>
    </PlainShell>
  );
}
