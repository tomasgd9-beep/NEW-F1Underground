// Data for the Points page: every asset's points for one race, plus Season
// and Last 3 as they stand now, and (after the deadline) how many picked it.
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPoints, constructors, people, picks, players, races, stints } from "@/db/schema";
import type { Breakdown } from "@/lib/fft";

export type PointsRow = {
  key: string;
  kind: "driver" | "constructor";
  ticker: string;
  name: string;
  team: string;
  colour: string;
  parts: Breakdown;
  total: number | null;
  season: number;
  last3: number;
  picked: number | null;
  doubled: number | null;
};

const n = (v: string | null | undefined) => (v == null ? 0 : Number(v));

export async function scoredRaces(db: Db, seasonId: number) {
  return db
    .select({ id: races.id, label: races.label, name: races.name, results: races.results, round: races.round })
    .from(races)
    .where(and(eq(races.seasonId, seasonId), ne(races.results, "none"), ne(races.status, "cancelled")))
    .orderBy(desc(races.round));
}

export async function pointsForRace(db: Db, raceId: number, leagueId: number): Promise<PointsRow[]> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race) return [];
  const seasonRaces = await scoredRaces(db, race.seasonId);
  const scoredIds = seasonRaces.map((r) => r.id);
  const last3Ids = scoredIds.slice(0, 3);

  const all = scoredIds.length
    ? await db
        .select({
          raceId: assetPoints.raceId,
          stintId: assetPoints.stintId,
          constructorId: assetPoints.constructorId,
          personId: stints.personId,
          total: assetPoints.total,
          breakdown: assetPoints.breakdown,
        })
        .from(assetPoints)
        .leftJoin(stints, eq(stints.id, assetPoints.stintId))
        .where(inArray(assetPoints.raceId, scoredIds))
    : [];
  const seasonBy = new Map<string, number>();
  const last3By = new Map<string, number>();
  for (const p of all) {
    const k = p.personId ? `p${p.personId}` : `c${p.constructorId}`;
    seasonBy.set(k, (seasonBy.get(k) ?? 0) + n(p.total));
    if (last3Ids.includes(p.raceId)) last3By.set(k, (last3By.get(k) ?? 0) + n(p.total));
  }

  // Picks are only shown once the race is locked.
  const pickCount = new Map<string, number>();
  const doubleCount = new Map<string, number>();
  if (race.lockedAt) {
    const rows = await db
      .select()
      .from(picks)
      .innerJoin(players, eq(players.id, picks.playerId))
      .where(and(eq(picks.raceId, raceId), eq(players.leagueId, leagueId)));
    for (const { picks: p } of rows) {
      // "picked" counts ×1 picks only; ×2 picks are counted separately.
      const ids = [
        ...[p.driver1StintId, p.driver2StintId, p.driver3StintId, p.driver4StintId].map((v) => v && `s${v}`),
        p.constructorId && `c${p.constructorId}`,
      ].filter(Boolean) as string[];
      for (const id of ids) pickCount.set(id, (pickCount.get(id) ?? 0) + 1);
      if (p.doubleStintId) doubleCount.set(`s${p.doubleStintId}`, (doubleCount.get(`s${p.doubleStintId}`) ?? 0) + 1);
    }
  }

  const stintInfo = await db
    .select({
      id: stints.id,
      personId: people.id,
      ticker: people.ticker,
      name: people.fullName,
      team: constructors.name,
      colour: constructors.colour,
    })
    .from(stints)
    .innerJoin(people, eq(people.id, stints.personId))
    .innerJoin(constructors, eq(constructors.id, stints.constructorId));
  const consInfo = await db.select().from(constructors);

  const out: PointsRow[] = [];
  for (const p of all.filter((x) => x.raceId === raceId)) {
    if (p.stintId) {
      const s = stintInfo.find((x) => x.id === p.stintId);
      if (!s) continue;
      const k = `s${s.id}`;
      out.push({
        key: k,
        kind: "driver",
        ticker: s.ticker,
        name: s.name,
        team: s.team,
        colour: s.colour,
        parts: p.breakdown as Breakdown,
        total: p.total == null ? null : n(p.total),
        season: seasonBy.get(`p${s.personId}`) ?? 0,
        last3: last3By.get(`p${s.personId}`) ?? 0,
        picked: race.lockedAt ? pickCount.get(k) ?? 0 : null,
        doubled: race.lockedAt ? doubleCount.get(k) ?? 0 : null,
      });
    } else if (p.constructorId) {
      const c = consInfo.find((x) => x.id === p.constructorId);
      if (!c) continue;
      const k = `c${c.id}`;
      out.push({
        key: k,
        kind: "constructor",
        ticker: c.ticker,
        name: c.name,
        team: c.name,
        colour: c.colour,
        parts: p.breakdown as Breakdown,
        total: p.total == null ? null : n(p.total),
        season: seasonBy.get(k) ?? 0,
        last3: last3By.get(k) ?? 0,
        picked: race.lockedAt ? pickCount.get(k) ?? 0 : null,
        doubled: null,
      });
    }
  }
  return out.sort((a, b) => (b.total ?? -999) - (a.total ?? -999) || a.ticker.localeCompare(b.ticker));
}
