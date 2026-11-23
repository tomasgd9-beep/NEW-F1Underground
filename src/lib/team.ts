// My team: which race is open, the asset list with prices and points, and saving picks.
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  assetOuts,
  assetPoints,
  assetPrices,
  constructors,
  people,
  picks as picksTable,
  races,
  seasons,
  stints,
} from "@/db/schema";
import { LeagueError, getPlayerForUser, logActivity } from "@/lib/league";
import {
  SLOTS,
  budgetPenalty,
  constructorAssetId,
  driverId,
  lineupIssues,
  parseAssetId,
  teamPrice,
  type AssetId,
  type LineupAsset,
  type Picks,
} from "@/lib/lineup";

export type Race = typeof races.$inferSelect;

export type TeamAsset = LineupAsset & {
  ticker: string;
  name: string;
  colour: string;
  team: string;
  season: number;
  last3: number;
  /** Price change since the previous race (null if there's no previous price). */
  move: number | null;
  /** Drivers only: the person behind the stint (prices are per person). */
  personId?: number;
};

/**
 * The race the league is on: the first race of the latest active season whose
 * results aren't final yet (so a race stays "current", locked, until it's scored).
 */
export async function currentRace(db: Db): Promise<(Race & { budget: number; doubleCap: number }) | undefined> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(ne(seasons.status, "finished"))
    .orderBy(desc(seasons.year))
    .limit(1);
  if (!season) return;
  const [race] = await db
    .select()
    .from(races)
    .where(and(eq(races.seasonId, season.id), ne(races.results, "final"), ne(races.status, "cancelled")))
    .orderBy(asc(races.round))
    .limit(1);
  if (!race) return;
  return { ...race, budget: Number(season.budget), doubleCap: Number(season.doubleCap) };
}

export function isLocked(race: Pick<Race, "deadline" | "lockedAt">, now = new Date()): boolean {
  return !!race.lockedAt || (!!race.deadline && race.deadline <= now);
}

const n = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

/**
 * Who a commissioner took out for a race: "p<personId>" / "c<constructorId>" → "weekend"
 * (this race only) or "inactive" (until turned back on).
 */
export async function outsFor(db: Db, raceId: number): Promise<Map<string, "weekend" | "inactive">> {
  const rows = await db
    .select()
    .from(assetOuts)
    .where(or(eq(assetOuts.raceId, raceId), isNull(assetOuts.raceId)));
  const out = new Map<string, "weekend" | "inactive">();
  for (const r of rows) {
    const k = r.personId ? `p${r.personId}` : `c${r.constructorId}`;
    if (out.get(k) !== "inactive") out.set(k, r.raceId ? "weekend" : "inactive");
  }
  return out;
}

/**
 * Every asset for a race with its price, Season, Last 3 and price move. Assets that aren't
 * racing (taken out by a commissioner, or dropped by f1fantasytools while still in someone's
 * saved team) come back with `out` set: they show in that team but can't be picked.
 */
export async function teamAssets(db: Db, race: Race): Promise<TeamAsset[]> {
  const outs = await outsFor(db, race.id);
  // Stints and teams still in a saved team for this race, even if f1fantasytools dropped them.
  const saved = await db.select().from(picksTable).where(eq(picksTable.raceId, race.id));
  const savedStints = [
    ...new Set(
      saved.flatMap((p) =>
        [p.doubleStintId, p.driver1StintId, p.driver2StintId, p.driver3StintId, p.driver4StintId].filter(
          (v): v is number => v != null,
        ),
      ),
    ),
  ];
  const savedCons = [...new Set(saved.map((p) => p.constructorId).filter((v): v is number => v != null))];
  const driverRows = await db
    .select({
      stintId: stints.id,
      personId: people.id,
      ticker: people.ticker,
      name: people.fullName,
      team: constructors.name,
      colour: constructors.colour,
      current: sql<boolean>`${stints.active} and ${stints.lastRaceId} is null`,
    })
    .from(stints)
    .innerJoin(people, eq(people.id, stints.personId))
    .innerJoin(constructors, eq(constructors.id, stints.constructorId))
    .where(
      or(
        and(eq(stints.active, true), isNull(stints.lastRaceId)),
        savedStints.length ? inArray(stints.id, savedStints) : sql`false`,
      ),
    );
  const teamRows = await db
    .select()
    .from(constructors)
    .where(or(eq(constructors.active, true), savedCons.length ? inArray(constructors.id, savedCons) : sql`false`));

  // Races of this season before this one, newest first: for Last 3 and the previous price.
  const earlier = await db
    .select({ id: races.id, results: races.results })
    .from(races)
    .where(and(eq(races.seasonId, race.seasonId), lt(races.round, race.round), ne(races.status, "cancelled")))
    .orderBy(desc(races.round));
  const scored = earlier.filter((r) => r.results !== "none").map((r) => r.id);
  const last3Ids = scored.slice(0, 3);
  const prevId = earlier[0]?.id;

  // Points per person (all their stints) and per constructor.
  const personPts = await db
    .select({ personId: stints.personId, raceId: assetPoints.raceId, total: assetPoints.total })
    .from(assetPoints)
    .innerJoin(stints, eq(stints.id, assetPoints.stintId))
    .where(scored.length ? inArray(assetPoints.raceId, scored) : sql`false`);
  const teamPts = await db
    .select({ constructorId: assetPoints.constructorId, raceId: assetPoints.raceId, total: assetPoints.total })
    .from(assetPoints)
    .where(
      and(
        sql`${assetPoints.constructorId} is not null`,
        scored.length ? inArray(assetPoints.raceId, scored) : sql`false`,
      ),
    );

  const sums = (rows: { key: number | null; raceId: number; total: string | null }[]) => {
    const season = new Map<number, number>();
    const last3 = new Map<number, number>();
    for (const r of rows) {
      if (r.key == null) continue;
      season.set(r.key, n(season.get(r.key)) + n(r.total));
      if (last3Ids.includes(r.raceId)) last3.set(r.key, n(last3.get(r.key)) + n(r.total));
    }
    return { season, last3 };
  };
  const P = sums(personPts.map((r) => ({ key: r.personId, raceId: r.raceId, total: r.total })));
  const C = sums(teamPts.map((r) => ({ key: r.constructorId, raceId: r.raceId, total: r.total })));

  // Prices: this race's row, else the newest earlier one.
  const priceRows = await db
    .select({
      raceId: assetPrices.raceId,
      round: races.round,
      personId: assetPrices.personId,
      constructorId: assetPrices.constructorId,
      price: assetPrices.finalPrice,
    })
    .from(assetPrices)
    .innerJoin(races, eq(races.id, assetPrices.raceId))
    .where(and(eq(races.seasonId, race.seasonId), sql`${races.round} <= ${race.round}`))
    .orderBy(desc(races.round));
  const price = (key: "personId" | "constructorId", id: number) => {
    const rows = priceRows.filter((r) => r[key] === id);
    const now = rows[0] ? n(rows[0].price) : 0;
    const prev = prevId ? rows.find((r) => r.raceId === prevId) : undefined;
    const thisRace = rows[0]?.raceId === race.id;
    return { now, move: thisRace && prev ? Math.round((now - n(prev.price)) * 100) / 100 : null };
  };

  const out: TeamAsset[] = [];
  for (const d of driverRows) {
    const p = price("personId", d.personId);
    out.push({
      id: driverId(d.stintId),
      kind: "driver",
      ticker: d.ticker,
      name: d.name,
      team: d.team,
      colour: d.colour,
      price: p.now,
      move: p.move,
      personId: d.personId,
      season: n(P.season.get(d.personId)),
      last3: n(P.last3.get(d.personId)),
      ...(!d.current ? { out: "fft" as const } : outs.has(`p${d.personId}`) ? { out: outs.get(`p${d.personId}`) } : {}),
    });
  }
  for (const c of teamRows) {
    const p = price("constructorId", c.id);
    out.push({
      id: constructorAssetId(c.id),
      kind: "constructor",
      ticker: c.ticker,
      name: c.name,
      team: c.name,
      colour: c.colour,
      price: p.now,
      move: p.move,
      season: n(C.season.get(c.id)),
      last3: n(C.last3.get(c.id)),
      ...(!c.active ? { out: "fft" as const } : outs.has(`c${c.id}`) ? { out: outs.get(`c${c.id}`) } : {}),
    });
  }
  return out.sort((a, b) => b.price - a.price || a.ticker.localeCompare(b.ticker));
}

type PickRow = typeof picksTable.$inferSelect;

export function rowToPicks(row: PickRow | undefined): Picks {
  if (!row) return {};
  const d = (v: number | null) => (v ? driverId(v) : null);
  return {
    double: d(row.doubleStintId),
    d1: d(row.driver1StintId),
    d2: d(row.driver2StintId),
    d3: d(row.driver3StintId),
    d4: d(row.driver4StintId),
    team: row.constructorId ? constructorAssetId(row.constructorId) : null,
  };
}

export async function myPicks(db: Db, playerId: number, raceId: number): Promise<PickRow | undefined> {
  const [row] = await db
    .select()
    .from(picksTable)
    .where(and(eq(picksTable.playerId, playerId), eq(picksTable.raceId, raceId)))
    .limit(1);
  return row;
}

/** Save the signed-in player's team for a race. The deadline is enforced here, not in the browser. */
export async function savePicks(
  db: Db,
  userId: string,
  raceId: number,
  picks: Picks,
  now = new Date(),
): Promise<{ savedAt: Date; price: number; penalty: number }> {
  const player = await getPlayerForUser(db, userId);
  if (!player?.active) throw new LeagueError("Only league members can save a team.");
  const race = await currentRace(db);
  if (!race || race.id !== raceId) throw new LeagueError("That race isn't open any more. Reload the page.");
  if (isLocked(race, now)) throw new LeagueError("The deadline has passed; teams are locked.");

  const assets = await teamAssets(db, race);
  const byId = new Map<AssetId, LineupAsset>(assets.map((a) => [a.id, a]));
  const clean: Picks = {};
  for (const s of SLOTS) {
    const v = picks[s];
    if (v != null && v !== "") {
      if (typeof v !== "string" || !parseAssetId(v)) throw new LeagueError("Unrecognised pick.");
      clean[s] = v;
    }
  }
  const issues = lineupIssues(clean, byId, race.doubleCap);
  if (issues.length) throw new LeagueError("Your team breaks a rule; fix the highlighted picks.");

  const num = (id: AssetId | null | undefined) => (id ? parseAssetId(id)!.num : null);
  const values = {
    doubleStintId: num(clean.double),
    driver1StintId: num(clean.d1),
    driver2StintId: num(clean.d2),
    driver3StintId: num(clean.d3),
    driver4StintId: num(clean.d4),
    constructorId: num(clean.team),
    origin: "manual" as const,
    savedAt: now,
  };
  await db
    .insert(picksTable)
    .values({ playerId: player.id, raceId, ...values })
    .onConflictDoUpdate({ target: [picksTable.playerId, picksTable.raceId], set: values });
  const price = teamPrice(clean, byId);
  await logActivity(db, userId, "team_saved", { raceId, playerId: player.id }, { leagueId: player.leagueId });
  return { savedAt: now, price, penalty: budgetPenalty(price, race.budget) };
}
