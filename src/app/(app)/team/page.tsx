import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { currentRace, isLocked, myPicks, rowToPicks, teamAssets } from "@/lib/team";
import { TeamBuilder } from "./team-builder";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const v = await requireMember();
  const db = getDb();
  const race = await currentRace(db);
  if (!race) {
    return (
      <section className="rounded-lg border border-line bg-card p-4 text-sm">
        <b>No race is open yet.</b> <span className="text-muted">The calendar appears here once it&apos;s synced.</span>
      </section>
    );
  }
  const [assets, row] = await Promise.all([teamAssets(db, race), myPicks(db, v.player.id, race.id)]);

  return (
    <TeamBuilder
      race={{
        id: race.id,
        label: race.label,
        name: race.name,
        isSprint: race.isSprint,
        deadline: race.deadline?.toISOString() ?? null,
        locked: isLocked(race),
      }}
      budget={race.budget}
      doubleCap={race.doubleCap}
      assets={assets}
      initialPicks={rowToPicks(row)}
      savedAt={row?.savedAt.toISOString() ?? null}
      origin={row?.origin ?? null}
    />
  );
}
