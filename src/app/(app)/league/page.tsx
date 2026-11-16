import { getDb } from "@/db";
import { getLeague } from "@/lib/league";
import { loadLeague } from "@/lib/league-data";
import { appUrl } from "@/lib/mail";
import { requireMember } from "@/lib/session";
import { LeagueView } from "./league-view";

export const dynamic = "force-dynamic";

export default async function LeaguePage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const v = await requireMember();
  const db = getDb();
  const { season } = await searchParams;
  const [league, data] = await Promise.all([
    getLeague(db, v.player.leagueId),
    loadLeague(db, v.player.leagueId, v.player.id, season ? Number(season) : undefined),
  ]);
  return (
    <LeagueView
      data={data}
      leagueName={league.name}
      code={league.codeActive ? league.code : null}
      joinUrl={`${appUrl()}/join/${league.code}`}
    />
  );
}
