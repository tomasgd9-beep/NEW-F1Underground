import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { players } from "@/db/schema";
import { PlainShell } from "@/components/plain-shell";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CodeForm } from "@/components/code-form";
import { pendingClaimForUser, resolveJoinKey, unclaimedPlayers } from "@/lib/league";
import { joinClaim, joinNew } from "@/app/actions";

export const dynamic = "force-dynamic";

/** /join/CODE (shared code link) or /join/<email-invite-token>. */
export default async function Join({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=${encodeURIComponent(`/join/${key}`)}`);

  const db = getDb();
  const jk = await resolveJoinKey(db, decodeURIComponent(key));
  if (!jk) {
    return (
      <PlainShell>
        <h1 className="text-lg font-bold">That code doesn&apos;t open a league</h1>
        <p className="text-sm text-muted">
          It may have been changed or paused, or an email invite was already used. Check the code and try again:
        </p>
        <div className="mt-3">
          <CodeForm autoFocus />
        </div>
      </PlainShell>
    );
  }

  const [member] = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.leagueId, jk.league.id), eq(players.userId, session.user.id)))
    .limit(1);
  if (member) redirect("/team");
  if (await pendingClaimForUser(db, session.user.id)) redirect("/welcome");
  const profiles = await unclaimedPlayers(db, jk.league.id);

  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Join {jk.league.name}</h1>
      <p className="text-sm text-muted">Signed in as {session.user.email}.</p>

      {profiles.length > 0 && (
        <ActionForm action={joinClaim} className="mt-4">
          <h2 className="text-sm font-bold">I already play</h2>
          <p className="text-xs text-muted">Pick your name; a commissioner confirms it&apos;s you.</p>
          <input type="hidden" name="key" value={key} />
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
        <input type="hidden" name="key" value={key} />
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
