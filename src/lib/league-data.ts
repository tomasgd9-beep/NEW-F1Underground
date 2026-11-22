// Everything the League page needs for one league and season, in one
// serialisable object. Picks of a race are only included once it's locked.
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPoints, constructors, people, picks, players, races, seasons, stints } from "@/db/schema";
import type { Breakdown } from "@/lib/fft";
import type { RaceTeam } from "@/lib/standings";

export type LeagueRace = {
  id: number;
  label: string;
  name: string;
  results: "none" | "live" | "provisional" | "final";
  locked: boolean;
  deadline: string | null;
};
export type LeagueAsset = {
  id: string;
  kind: "driver" | "constructor";
  ticker: string;
  name: string;
  team: string;
  colour: string;
  /** Person ("p3") or constructor ("c2"): Season and Last 3 belong to it. */
  statKey: string;
};
export type LeagueData = {
  season: { id: number; year: number };
  seasons: { id: number; year: number }[];
  races: LeagueRace[];
  players: { id: number; name: string; joinedRaceId: number | null }[];
  meId: number;
  /** teams[raceId][playerId], locked races only. */
  teams: Record<number, Record<number, RaceTeam>>;
  /** Players who have saved a team for the open (unlocked) race. */
  submitted: Record<number, number[]>;
  points: Record<number, Record<string, number | null>>;
  parts: Record<number, Record<string, Breakdown>>;
  assets: Record<string, LeagueAsset>;
  stats: Record<string, { season: number; last3: number }>;
};

const n = (v: string | null | undefined) => (v == null ? null : Number(v));

export async function loadLeague(
  db: Db,
  leagueId: number,
  meId: number,
  seasonId?: number,
): Promise<LeagueData | null> {
  // Only seasons that have races on the site (earlier years lived in other spreadsheets).
  const allSeasons = await db
    .selectDistinct({ id: seasons.id, year: seasons.year })
    .from(seasons)
    .innerJoin(races, eq(races.seasonId, seasons.id))
    .orderBy(asc(seasons.year));
  if (!allSeasons.length) return null;
  const season = allSeasons.find((s) => s.id === seasonId) ?? allSeasons.at(-1)!;

  const raceRows = await db
    .select()
    .from(races)
    .where(and(eq(races.seasonId, season.id), ne(races.status, "cancelled")))
    .orderBy(asc(races.round));
  // Races that matter: scored or locked, plus the one open for picks.
  const shown = raceRows.filter((r) => r.results !== "none" || r.lockedAt);
  const open = raceRows.find((r) => !r.lockedAt && r.results !== "final");
  if (open && !shown.includes(open)) shown.push(open);
  const raceIds = shown.map((r) => r.id);

  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.leagueId, leagueId))
    .orderBy(asc(players.displayName));
  const playerIds = playerRows.map((p) => p.id);

  const lockedIds = shown.filter((r) => r.lockedAt).map((r) => r.id);
  const pickRows =
    raceIds.length && playerIds.length
      ? await db
          .select()
          .from(picks)
          .where(and(inArray(picks.raceId, raceIds), inArray(picks.playerId, playerIds)))
      : [];

  const teams: LeagueData["teams"] = {};
  const submitted: LeagueData["submitted"] = {};
  for (const p of pickRows) {
    if (!lockedIds.includes(p.raceId)) {
      // Before the deadline: only whether a team exists, never the picks.
      (submitted[p.raceId] ??= []).push(p.playerId);
      continue;
    }
    const team: RaceTeam = { picks: [], penalty: p.penalty ?? 0, origin: p.origin, adjust: p.scoreAdjust ?? 0 };
    if (p.doubleStintId) team.picks.push({ assetId: `s${p.doubleStintId}`, slot: "x2" });
    for (const d of [p.driver1StintId, p.driver2StintId, p.driver3StintId, p.driver4StintId]) {
      if (d) team.picks.push({ assetId: `s${d}`, slot: "d" });
    }
    if (p.constructorId) team.picks.push({ assetId: `c${p.constructorId}`, slot: "c" });
    (teams[p.raceId] ??= {})[p.playerId] = team;
  }

  const ptRows = raceIds.length ? await db.select().from(assetPoints).where(inArray(assetPoints.raceId, raceIds)) : [];
  const points: LeagueData["points"] = {};
  const parts: LeagueData["parts"] = {};
  for (const p of ptRows) {
    const id = p.stintId ? `s${p.stintId}` : `c${p.constructorId}`;
    (points[p.raceId] ??= {})[id] = n(p.total);
    (parts[p.raceId] ??= {})[id] = p.breakdown as Breakdown;
  }

  const assets: LeagueData["assets"] = {};
  const stintRows = await db
    .select({
      id: stints.id,
      personId: stints.personId,
      ticker: people.ticker,
      name: people.fullName,
      team: constructors.name,
      colour: constructors.colour,
    })
    .from(stints)
    .innerJoin(people, eq(people.id, stints.personId))
    .innerJoin(constructors, eq(constructors.id, stints.constructorId));
  for (const s of stintRows) {
    assets[`s${s.id}`] = {
      id: `s${s.id}`,
      kind: "driver",
      ticker: s.ticker,
      name: s.name,
      team: s.team,
      colour: s.colour,
      statKey: `p${s.personId}`,
    };
  }
  for (const c of await db.select().from(constructors)) {
    assets[`c${c.id}`] = {
      id: `c${c.id}`,
      kind: "constructor",
      ticker: c.ticker,
      name: c.name,
      team: c.name,
      colour: c.colour,
      statKey: `c${c.id}`,
    };
  }

  // Season and Last 3 as they stand now (person-level for drivers).
  const scored = shown.filter((r) => r.results !== "none").map((r) => r.id);
  const last3 = scored.slice(-3);
  const stats: LeagueData["stats"] = {};
  for (const p of ptRows) {
    if (!scored.includes(p.raceId)) continue;
    const a = assets[p.stintId ? `s${p.stintId}` : `c${p.constructorId}`];
    if (!a) continue;
    const s = (stats[a.statKey] ??= { season: 0, last3: 0 });
    s.season += n(p.total) ?? 0;
    if (last3.includes(p.raceId)) s.last3 += n(p.total) ?? 0;
  }

  return {
    season,
    seasons: allSeasons,
    races: shown.map((r) => ({
      id: r.id,
      label: r.label,
      name: r.name,
      results: r.results,
      locked: !!r.lockedAt,
      deadline: r.deadline?.toISOString() ?? null,
    })),
    // A finished season shows only the people who played it.
    players: playerRows
      .filter((p) => (p.active && season.id === allSeasons.at(-1)!.id) || pickRows.some((x) => x.playerId === p.id))
      .map((p) => ({
        id: p.id,
        name: p.displayName,
        joinedRaceId: p.joinedAtRaceId,
      })),
    meId,
    teams,
    submitted,
    points,
    parts,
    assets,
    stats,
  };
}
