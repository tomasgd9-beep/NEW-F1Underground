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
  /** Season and Last 3 as of this race (it and the races before it), and how many races it scored in. */
  season: number;
  last3: number;
  races: number;
  /** The same three figures as they stand now (only when an earlier race is chosen). */
  now: { season: number; last3: number; races: number } | null;
  picked: number | null;
  doubled: number | null;
  /** Who picked it (locked races only): as ×2 and as a regular pick. */
  pickedBy: { x2: string[]; x1: string[] } | null;
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
  // As of this race: a past race shows the standings as they were after it.
  const allScored = await scoredRaces(db, race.seasonId);
  const seasonRaces = allScored.filter((r) => r.round <= race.round);
  const scoredIds = seasonRaces.map((r) => r.id);
  const last3Ids = scoredIds.slice(0, 3);
  // A race before the latest one also gets the figures as they stand now.
  const isLatest = allScored[0]?.id === race.id;
  const nowIds = allScored.map((r) => r.id);
  const nowLast3 = nowIds.slice(0, 3);

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
        .where(inArray(assetPoints.raceId, isLatest ? scoredIds : nowIds))
    : [];
  const sumUp = (raceIds: number[], last3: number[]) => {
    const season = new Map<string, number>();
    const l3 = new Map<string, number>();
    const count = new Map<string, Set<number>>();
    for (const p of all) {
      if (!raceIds.includes(p.raceId)) continue;
      const k = p.personId ? `p${p.personId}` : `c${p.constructorId}`;
      season.set(k, (season.get(k) ?? 0) + n(p.total));
      count.set(k, (count.get(k) ?? new Set()).add(p.raceId));
      if (last3.includes(p.raceId)) l3.set(k, (l3.get(k) ?? 0) + n(p.total));
    }
    return { season, l3, count };
  };
  const NOW = isLatest ? null : sumUp(nowIds, nowLast3);
  const nowOf = (k: string) =>
    NOW ? { season: NOW.season.get(k) ?? 0, last3: NOW.l3.get(k) ?? 0, races: NOW.count.get(k)?.size ?? 0 } : null;
  const seasonBy = new Map<string, number>();
  const last3By = new Map<string, number>();
  const racesBy = new Map<string, Set<number>>();
  for (const p of all) {
    if (!scoredIds.includes(p.raceId)) continue;
    const k = p.personId ? `p${p.personId}` : `c${p.constructorId}`;
    seasonBy.set(k, (seasonBy.get(k) ?? 0) + n(p.total));
    racesBy.set(k, (racesBy.get(k) ?? new Set()).add(p.raceId));
    if (last3Ids.includes(p.raceId)) last3By.set(k, (last3By.get(k) ?? 0) + n(p.total));
  }

  // Picks are only shown once the race is locked.
  const pickCount = new Map<string, number>();
  const doubleCount = new Map<string, number>();
  const byX1 = new Map<string, string[]>();
  const byX2 = new Map<string, string[]>();
  if (race.lockedAt) {
    const rows = await db
      .select()
      .from(picks)
      .innerJoin(players, eq(players.id, picks.playerId))
      .where(and(eq(picks.raceId, raceId), eq(players.leagueId, leagueId)));
    rows.sort((a, b) => a.players.displayName.localeCompare(b.players.displayName));
    for (const { picks: p, players: pl } of rows) {
      // "picked" counts ×1 picks only; ×2 picks are counted separately.
      const ids = [
        ...[p.driver1StintId, p.driver2StintId, p.driver3StintId, p.driver4StintId].map((v) => v && `s${v}`),
        p.constructorId && `c${p.constructorId}`,
      ].filter(Boolean) as string[];
      for (const id of ids) {
        pickCount.set(id, (pickCount.get(id) ?? 0) + 1);
        byX1.set(id, [...(byX1.get(id) ?? []), pl.displayName]);
      }
      if (p.doubleStintId) {
        const id = `s${p.doubleStintId}`;
        doubleCount.set(id, (doubleCount.get(id) ?? 0) + 1);
        byX2.set(id, [...(byX2.get(id) ?? []), pl.displayName]);
      }
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
        races: racesBy.get(`p${s.personId}`)?.size ?? 0,
        now: nowOf(`p${s.personId}`),
        picked: race.lockedAt ? pickCount.get(k) ?? 0 : null,
        doubled: race.lockedAt ? doubleCount.get(k) ?? 0 : null,
        pickedBy: race.lockedAt ? { x2: byX2.get(k) ?? [], x1: byX1.get(k) ?? [] } : null,
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
        races: racesBy.get(k)?.size ?? 0,
        now: nowOf(k),
        picked: race.lockedAt ? pickCount.get(k) ?? 0 : null,
        doubled: null,
        pickedBy: race.lockedAt ? { x2: [], x1: byX1.get(k) ?? [] } : null,
      });
    }
  }
  return out.sort((a, b) => (b.total ?? -999) - (a.total ?? -999) || a.ticker.localeCompare(b.ticker));
}
