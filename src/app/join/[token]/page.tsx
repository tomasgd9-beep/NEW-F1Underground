import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { PlainShell } from "@/components/plain-shell";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { findUsableInvite, getPlayerForUser, pendingClaimForUser, unclaimedPlayers } from "@/lib/league";
import { joinClaim, joinNew } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const invite = await findUsableInvite(db, token);
  if (!invite) {
    return (
      <PlainShell>
        <h1 className="text-lg font-bold">This invite doesn&apos;t work any more</h1>
        <p className="text-sm text-muted">Ask a league member for the current join link.</p>
      </PlainShell>
    );
  }

  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=${encodeURIComponent(`/join/${token}`)}`);
  if (await getPlayerForUser(db, session.user.id)) redirect("/team");
  if (await pendingClaimForUser(db, session.user.id)) redirect("/welcome");
  const profiles = await unclaimedPlayers(db);

  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Join F1 Underground</h1>
      <p className="text-sm text-muted">Signed in as {session.user.email}.</p>

      {profiles.length > 0 && (
        <ActionForm action={joinClaim} className="mt-4">
          <h2 className="text-sm font-bold">I already play</h2>
          <p className="text-xs text-muted">Pick your name; a commissioner confirms it&apos;s you.</p>
          <input type="hidden" name="token" value={token} />
          <div className="mt-2 flex gap-2">
            <select name="playerId" required className="min-w-0 flex-1 rounded border border-line bg-card px-2 py-1.5">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <SubmitButton>This is me</SubmitButton>
          </div>
        </ActionForm>
      )}

      <ActionForm action={joinNew} className="mt-5">
        <h2 className="text-sm font-bold">I&apos;m new</h2>
        <p className="text-xs text-muted">You start at 0 points from the next race.</p>
        <input type="hidden" name="token" value={token} />
        <div className="mt-2 flex gap-2">
          <input
            name="name"
            required
            minLength={2}
            maxLength={40}
            placeholder="Name shown in the league"
            defaultValue={session.user.name ?? ""}
            className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1.5"
          />
          <SubmitButton>Join</SubmitButton>
        </div>
      </ActionForm>
    </PlainShell>
  );
}
