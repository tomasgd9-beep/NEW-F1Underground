import { and, asc, desc, eq, ne } from "drizzle-orm";
import { LeagueHeader } from "@/components/league-header";
import { RacePicker } from "@/components/race-picker";
import { getLeague } from "@/lib/league";
import { appUrl } from "@/lib/mail";
import { getDb } from "@/db";
import { assetPoints, races, seasons } from "@/db/schema";
import { pointsForRace, scoredRaces } from "@/lib/points";
import { requireMember } from "@/lib/session";
import { PointsTable } from "./points-table";

export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = {
  live: "bg-red text-white",
  provisional: "bg-navy text-white",
  final: "bg-black/10 dark:bg-white/15",
};

export default async function PointsPage({ searchParams }: { searchParams: Promise<{ race?: string; season?: string }> }) {
  const v = await requireMember();
  const db = getDb();
  const { race: q, season: sq } = await searchParams;
  // Seasons with scored races only (earlier years lived in other spreadsheets).
  const withPoints = await db
    .selectDistinct({ id: seasons.id, year: seasons.year })
    .from(seasons)
    .innerJoin(races, eq(races.seasonId, seasons.id))
    .where(and(ne(seasons.status, "upcoming"), ne(races.results, "none")))
    .orderBy(asc(seasons.year));
  const season = withPoints.find((s) => String(s.id) === sq) ?? withPoints.at(-1);
  const league = await getLeague(db, v.player.leagueId);
  const header = (
    <LeagueHeader
      leagueName={league.name}
      seasons={withPoints}
      seasonId={season?.id ?? null}
      basePath="/points"
      code={league.codeActive ? league.code : null}
      joinUrl={`${appUrl()}/join/${league.code}`}
    />
  );
  const list = season ? await scoredRaces(db, season.id) : [];
  if (!list.length) {
    return (
      <div className="grid gap-3">
        {header}
        <section className="rounded-lg border border-line bg-card p-4 text-sm">
          <b>No points yet.</b> <span className="text-muted">They appear here once the first session of a race starts.</span>
        </section>
      </div>
    );
  }
  const chosen = list.find((r) => String(r.id) === q) ?? list[0];
  const rows = await pointsForRace(db, chosen.id, v.player.leagueId);
  const [{ updatedAt } = { updatedAt: null }] = await db
    .select({ updatedAt: assetPoints.updatedAt })
    .from(assetPoints)
    .where(and(eq(assetPoints.raceId, chosen.id)))
    .orderBy(desc(assetPoints.updatedAt))
    .limit(1);
  const [raceRow] = await db.select().from(races).where(eq(races.id, chosen.id));
  // The whole season in the picker: races to come and cancelled ones are shown, greyed.
  const allRaces = await db.select().from(races).where(eq(races.seasonId, season!.id)).orderBy(asc(races.round));
  const pickerRaces = allRaces.map((r) => {
    const scored = list.some((x) => x.id === r.id);
    return {
      id: r.id,
      label: r.label,
      name: r.name,
      ...(scored
        ? { href: `/points?season=${season!.id}&race=${r.id}` }
        : { note: r.status === "cancelled" ? "cancelled" : "upcoming" }),
    };
  });

  return (
    <div className="grid gap-3">
      {header}
      <section className="flex flex-wrap items-center gap-2">
        <RacePicker races={pickerRaces} currentId={chosen.id} />
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${BADGE[chosen.results] ?? ""}`}>
          {chosen.results}
        </span>
        {updatedAt && (
          <span className="text-xs text-muted" suppressHydrationWarning>
            updated{" "}
            {updatedAt.toLocaleString("en-CA", {
              timeZone: "America/Toronto",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </section>
      <PointsTable rows={rows} raceName={chosen.name} raceLabel={chosen.label} locked={!!raceRow?.lockedAt} />
    </div>
  );
}
