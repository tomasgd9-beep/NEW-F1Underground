// The scheduled job's database work: keep races, assets and points in step
// with f1fantasytools, lock teams at the deadline, and price the next race.
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  assetPoints,
  assetPrices,
  constructors,
  leagues,
  people,
  picks,
  players,
  pricePeers,
  races,
  jobState,
  seasons,
  stints,
  xpSnapshots,
} from "@/db/schema";
import {
  CONSTRUCTOR_NAMES,
  DRIVER_NAMES,
  breakdown,
  deadlineOf,
  raceLabel,
  resultsState,
  sessionsStarted,
  type FftLive,
  type FftRace,
} from "@/lib/fft";
import { logActivity } from "@/lib/league";
import { budgetPenalty, constructorAssetId, driverId, parseAssetId } from "@/lib/lineup";
import { fillPartial, randomTeams, teamKey, type Team } from "@/lib/optimiser";
import { applyFloor, formulaPrice, round2 } from "@/lib/pricing";
import { currentRace, teamAssets, type Race } from "@/lib/team";

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

/** Very light team colours (Haas is white) vanish on a white page; use grey instead. */
function visibleColour(hex?: string) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "#888888";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 225 ? "#B6BABD" : hex;
}

/* ───────────────────────────── Races ───────────────────────────── */

/**
 * The league numbers races by the original calendar, so cancelled rounds keep their number
 * (2026: R4 and R5 were cancelled, so f1fantasytools' round 21 is the league's R23).
 * A new race continues from the league label of the race before it in the season.
 */
async function leagueLabel(db: Db, seasonId: number, r: FftRace): Promise<string> {
  const auto = raceLabel(r);
  const [prev] = await db
    .select({ round: races.round, label: races.label })
    .from(races)
    .where(and(eq(races.seasonId, seasonId), lt(races.round, r.roundNumber)))
    .orderBy(desc(races.round))
    .limit(1);
  const m = prev?.label.match(/^R(\d+)/);
  if (!prev || !m) return auto;
  const n = Number(m[1]) + (r.roundNumber - prev.round);
  return `R${String(n).padStart(2, "0")}${auto.slice(auto.indexOf(" "))}`;
}

async function upsertRace(db: Db, seasonId: number, r: FftRace, withStatus: boolean): Promise<Race> {
  const dl = deadlineOf(r);
  const times = Object.fromEntries(Object.entries(r.start_times ?? {}).filter(([, v]) => !!v)) as Record<string, string>;
  const state = withStatus ? resultsState(r) : undefined;
  const [existing] = await db.select().from(races).where(eq(races.fftId, r.id)).limit(1);
  const common = {
    name: r.name,
    country: r.countryName ?? r.countryCode ?? null,
    isSprint: !!r.sprint,
    sessionTimes: times,
    ...(state ? { results: state, ...(state !== "none" && r.status?.race?.finished ? { status: "completed" as const } : {}) } : {}),
  };
  if (existing) {
    // A label still in f1fantasytools' numbering (never renamed by a commissioner) follows the league's.
    const relabel = existing.label === raceLabel(r) ? await leagueLabel(db, seasonId, r) : existing.label;
    const [u] = await db
      .update(races)
      .set({
        ...common,
        ...(relabel !== existing.label ? { label: relabel } : {}),
        // A race the commissioner cancelled stays cancelled.
        ...(existing.status === "cancelled" ? { status: "cancelled" as const } : {}),
        ...(existing.deadlineManual || !dl ? {} : { deadline: dl.when }),
      })
      .where(eq(races.id, existing.id))
      .returning();
    return u;
  }
  const [c] = await db
    .insert(races)
    .values({
      seasonId,
      round: r.roundNumber,
      label: await leagueLabel(db, seasonId, r),
      fftId: r.id,
      deadline: dl?.when ?? null,
      ...common,
    })
    .returning();
  return c;
}

/* ───────────────────────────── Assets ───────────────────────────── */

async function upsertAssets(db: Db, live: FftLive, currentRaceId: number) {
  const consByFft = new Map<string, number>();
  for (const c of live.constructors) {
    const [row] = await db
      .insert(constructors)
      .values({
        ticker: c.abbreviation,
        name: CONSTRUCTOR_NAMES[c.abbreviation] ?? c.abbreviation,
        colour: visibleColour(c.color),
        fftId: c.id,
        active: c.isActive,
      })
      .onConflictDoUpdate({ target: constructors.ticker, set: { fftId: c.id, active: c.isActive } })
      .returning({ id: constructors.id });
    consByFft.set(c.id, row.id);
  }
  for (const d of live.drivers) {
    const [person] = await db
      .insert(people)
      .values({ ticker: d.abbreviation, fullName: DRIVER_NAMES[d.abbreviation] ?? d.abbreviation })
      .onConflictDoUpdate({
        target: people.ticker,
        // Fill in a full name we didn't know before; never overwrite one a commissioner set.
        set: { fullName: sql`case when ${people.fullName} = ${people.ticker} then excluded.full_name else ${people.fullName} end` },
      })
      .returning({ id: people.id });
    const consId = consByFft.get(d.constructorId ?? "");
    if (!consId) continue;
    const [existing] = await db.select().from(stints).where(eq(stints.fftId, d.id)).limit(1);
    if (existing) {
      await db
        .update(stints)
        .set({
          active: d.isActive,
          // A stint that went inactive ends at the current race; one that comes back is current again.
          lastRaceId: d.isActive ? null : existing.lastRaceId ?? currentRaceId,
        })
        .where(eq(stints.id, existing.id));
    } else {
      await db.insert(stints).values({
        personId: person.id,
        constructorId: consId,
        fftId: d.id,
        firstRaceId: currentRaceId,
        active: d.isActive,
        lastRaceId: d.isActive ? null : currentRaceId,
      });
    }
  }
}

/* ───────────────────────────── Points ───────────────────────────── */

async function writePoints(db: Db, live: FftLive, raceId: number): Promise<number> {
  const started = sessionsStarted(live.race);
  if (!started.S && !started.Q && !started.R) return 0;
  const isFinal = resultsState(live.race) === "final";
  const stintRows = await db.select({ id: stints.id, fftId: stints.fftId }).from(stints);
  const consRows = await db.select({ id: constructors.id, fftId: constructors.fftId }).from(constructors);
  const stintBy = new Map(stintRows.map((s) => [s.fftId, s.id]));
  const consBy = new Map(consRows.map((c) => [c.fftId, c.id]));
  let n = 0;
  for (const a of [...live.drivers, ...live.constructors]) {
    if (!a.isActive) continue; // replaced or absent drivers are never written (as in the sheet)
    const b = breakdown(a, started);
    const values = {
      breakdown: b.parts as Record<string, Record<string, number>>,
      sprintTotal: b.parts.S ? String(b.parts.S.total) : null,
      qualiTotal: b.parts.Q ? String(b.parts.Q.total) : null,
      raceTotal: b.parts.R ? String(b.parts.R.total) : null,
      total: b.total == null ? null : String(b.total),
      isFinal,
      updatedAt: new Date(),
    };
    if (a.type === "driver") {
      const stintId = stintBy.get(a.id);
      if (!stintId) continue;
      await db
        .insert(assetPoints)
        .values({ raceId, stintId, ...values })
        .onConflictDoUpdate({ target: [assetPoints.raceId, assetPoints.stintId], set: values, setWhere: eq(assetPoints.manual, false) });
    } else {
      const constructorId = consBy.get(a.id);
      if (!constructorId) continue;
      await db
        .insert(assetPoints)
        .values({ raceId, constructorId, ...values })
        .onConflictDoUpdate({
          target: [assetPoints.raceId, assetPoints.constructorId],
          set: values,
          setWhere: eq(assetPoints.manual, false),
        });
    }
    n++;
  }
  return n;
}

export type SyncSummary = { season: number; current: string; next: string | null; points: number; state: string };

/** Bring races, assets and the current race's points up to date. */
export async function syncFromFft(db: Db, live: FftLive): Promise<SyncSummary> {
  const year = live.race.season ?? Number(live.race.id.split("_")[0]);
  const [season] = await db
    .insert(seasons)
    .values({ year, status: "active" })
    .onConflictDoUpdate({ target: seasons.year, set: { status: "active" } })
    .returning();
  const cur = await upsertRace(db, season.id, live.race, true);
  const nxt = live.race.nextRace ? await upsertRace(db, season.id, live.race.nextRace, false) : null;
  await upsertAssets(db, live, cur.id);
  const points = await writePoints(db, live, cur.id);
  return { season: year, current: cur.label, next: nxt?.label ?? null, points, state: cur.results };
}

/* ───────────────────────────── Lock ───────────────────────────── */

export type LockSummary = {
  race: string;
  /** What the auto-filled and random teams were based on. */
  xpSource?: string;
  leagues: { name: string; kept: number; autoFilled: number; random: number }[];
};

/**
 * At the deadline: fill partial teams, give empty ones a random top team,
 * record each team's frozen price and penalty, freeze prices, mark locked.
 * `xpByFft` are expected points keyed by f1fantasytools id ("RED_VER", "RED").
 */
export async function lockRace(
  db: Db,
  race: Race,
  xpByFft: Record<string, number> | null,
  opts: { now?: Date; force?: boolean; rng?: () => number; actor?: string; xpSource?: string } = {},
): Promise<LockSummary | null> {
  const now = opts.now ?? new Date();
  if (race.lockedAt) return null;
  if (!opts.force && (!race.deadline || race.deadline > now)) return null;

  const assets = await teamAssets(db, race);
  if (!assets.some((a) => a.price > 0)) {
    throw new Error(`No prices for ${race.label} yet, so teams can't be auto-filled. Import prices on Admin.`);
  }
  // Claim the lock first, so two runs at the same moment (schedule, a page visit, Lock now)
  // can't both fill teams. If anything below fails, the claim is released.
  const claimed = await db
    .update(races)
    .set({ lockedAt: now })
    .where(and(eq(races.id, race.id), isNull(races.lockedAt)))
    .returning({ id: races.id });
  if (!claimed.length) return null;
  try {
    return await fillAndFreeze(db, race, assets, xpByFft, now, opts);
  } catch (e) {
    await db.update(races).set({ lockedAt: null }).where(eq(races.id, race.id));
    throw e;
  }
}

async function fillAndFreeze(
  db: Db,
  race: Race,
  assets: Awaited<ReturnType<typeof teamAssets>>,
  xpByFft: Record<string, number> | null,
  now: Date,
  opts: { rng?: () => number; actor?: string; xpSource?: string },
): Promise<LockSummary> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, race.seasonId));
  const budget = num(season.budget);
  const cap = num(season.doubleCap);

  // Expected points per app asset id; falls back to season points (as the sheet did).
  const fftOf = new Map<string, string>();
  for (const s of await db.select({ id: stints.id, fftId: stints.fftId }).from(stints)) {
    if (s.fftId) fftOf.set(driverId(s.id), s.fftId);
  }
  for (const c of await db.select({ id: constructors.id, fftId: constructors.fftId }).from(constructors)) {
    if (c.fftId) fftOf.set(constructorAssetId(c.id), c.fftId);
  }
  const xp: Record<string, number> = {};
  const price: Record<string, number> = {};
  for (const a of assets) {
    const f = fftOf.get(a.id);
    xp[a.id] = xpByFft && f && f in xpByFft ? xpByFft[f] : a.season;
    price[a.id] = a.price;
  }
  const D = assets.filter((a) => a.kind === "driver").map((a) => a.id);
  const C = assets.filter((a) => a.kind === "constructor").map((a) => a.id);
  const valid = new Set(assets.map((a) => a.id));

  const xpSource = xpByFft ? (opts.xpSource ?? "f1fantasytools expected points") : "season points (no expected points)";
  const summary: LockSummary = { race: race.label, xpSource, leagues: [] };
  for (const lg of await db.select().from(leagues)) {
    const members = await db
      .select({ id: players.id, joinedAt: players.joinedAtRaceId })
      .from(players)
      .where(and(eq(players.leagueId, lg.id), eq(players.active, true)));
    const joinedRounds = new Map<number, number>();
    for (const r of await db.select({ id: races.id, round: races.round }).from(races)) joinedRounds.set(r.id, r.round);
    const eligible = members.filter((m) => !m.joinedAt || (joinedRounds.get(m.joinedAt) ?? 0) <= race.round);
    if (!eligible.length) continue;

    const rows = eligible.length
      ? await db
          .select()
          .from(picks)
          .where(and(eq(picks.raceId, race.id), inArray(picks.playerId, eligible.map((m) => m.id))))
      : [];
    const byPlayer = new Map(rows.map((r) => [r.playerId, r]));
    const toTeam = (r: (typeof rows)[number] | undefined): Team => {
      const d = (v: number | null) => (v && valid.has(driverId(v)) ? driverId(v) : null);
      return {
        x2: d(r?.doubleStintId ?? null),
        x1: [r?.driver1StintId, r?.driver2StintId, r?.driver3StintId, r?.driver4StintId]
          .map((v) => d(v ?? null))
          .filter((v): v is string => !!v),
        c: r?.constructorId && valid.has(constructorAssetId(r.constructorId)) ? constructorAssetId(r.constructorId) : null,
      };
    };
    const teams = eligible.map((m) => ({ playerId: m.id, team: toTeam(byPlayer.get(m.id)) }));
    const filled = (t: Team) => (t.x2 ? 1 : 0) + t.x1.length + (t.c ? 1 : 0);
    const taken = new Set(teams.filter((t) => filled(t.team) === 6).map((t) => teamKey(t.team)));

    let kept = 0, autoFilled = 0;
    const empties: typeof teams = [];
    const results: { playerId: number; team: Team; origin: "manual" | "random" | "auto_filled" }[] = [];
    for (const t of teams) {
      const f = filled(t.team);
      if (f === 6) {
        results.push({ ...t, origin: "manual" });
        kept++;
      } else if (f === 0) empties.push(t);
      else {
        const best = fillPartial(t.team, D, C, xp, price, budget, cap);
        if (best) {
          results.push({ playerId: t.playerId, team: best.team, origin: "auto_filled" });
          autoFilled++;
        } else empties.push(t);
      }
    }
    const randoms = randomTeams(empties.length, taken, D, C, xp, price, opts.rng, budget, cap);
    empties.forEach((t, i) => {
      if (randoms[i]) results.push({ playerId: t.playerId, team: randoms[i].team, origin: "random" });
    });

    for (const r of results) {
      const all = [r.team.x2, ...r.team.x1, r.team.c].filter(Boolean) as string[];
      const cost = round2(all.reduce((s, id) => s + (price[id] ?? 0), 0));
      const n = (id: string | null | undefined) => (id ? parseAssetId(id)!.num : null);
      const values = {
        doubleStintId: n(r.team.x2),
        driver1StintId: n(r.team.x1[0]),
        driver2StintId: n(r.team.x1[1]),
        driver3StintId: n(r.team.x1[2]),
        driver4StintId: n(r.team.x1[3]),
        constructorId: n(r.team.c),
        frozenTeamPrice: String(cost),
        penalty: budgetPenalty(cost, budget),
      };
      const existing = byPlayer.get(r.playerId);
      if (existing) {
        await db
          .update(picks)
          .set(r.origin === "manual" ? { frozenTeamPrice: values.frozenTeamPrice, penalty: values.penalty } : { ...values, origin: r.origin })
          .where(eq(picks.id, existing.id));
      } else {
        await db.insert(picks).values({ playerId: r.playerId, raceId: race.id, ...values, origin: r.origin, savedAt: now });
      }
    }
    const s = { name: lg.name, kept, autoFilled, random: randoms.length };
    summary.leagues.push(s);
    await logActivity(db, opts.actor ?? "job", "teams_locked", { race: race.label, ...s, xpSource }, { leagueId: lg.id });
  }

  await db.update(assetPrices).set({ frozenAt: now }).where(and(eq(assetPrices.raceId, race.id), isNull(assetPrices.frozenAt)));
  return summary;
}

/* ───────────────────────────── Prices ───────────────────────────── */

/**
 * Once a race is final, price the next race of the season with the league
 * formula, unless it already has prices (e.g. imported or set by hand).
 */
type PriceRow = {
  personId: number | null;
  constructorId: number | null;
  lastSeasonPrice: number;
  last3: number;
  racesCounted: number;
  formula: number;
};

/** Each asset's formula price for the race after `finished` (before the floor), from that season's points. */
async function pricesAfter(db: Db, finished: Race): Promise<PriceRow[]> {
  const base = await db.select().from(assetPrices).where(eq(assetPrices.raceId, finished.id));
  if (!base.length) return [];
  // Scored races of the season up to the finished one, newest first.
  const scored = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        eq(races.seasonId, finished.seasonId),
        sql`${races.round} <= ${finished.round}`,
        ne(races.results, "none"),
        ne(races.status, "cancelled"),
      ),
    )
    .orderBy(desc(races.round));
  const scoredIds = scored.map((r) => r.id);
  const last3Ids = scoredIds.slice(0, 3);
  const pts = scoredIds.length
    ? await db
        .select({
          raceId: assetPoints.raceId,
          personId: stints.personId,
          constructorId: assetPoints.constructorId,
          total: assetPoints.total,
        })
        .from(assetPoints)
        .leftJoin(stints, eq(stints.id, assetPoints.stintId))
        .where(inArray(assetPoints.raceId, scoredIds))
    : [];
  const stat = (key: "personId" | "constructorId", id: number) => {
    const mine = pts.filter((p) => p[key] === id && p.total != null);
    const racedIn = new Set(mine.map((p) => p.raceId));
    const last3 = mine.filter((p) => last3Ids.includes(p.raceId)).reduce((s, p) => s + num(p.total), 0);
    return { races: Math.min(3, racedIn.size), last3 };
  };
  return base.map((b) => {
    const st = b.personId ? stat("personId", b.personId) : stat("constructorId", b.constructorId!);
    const lsp = num(b.lastSeasonPrice ?? b.finalPrice);
    return {
      personId: b.personId,
      constructorId: b.constructorId,
      lastSeasonPrice: lsp,
      last3: st.last3,
      racesCounted: st.races,
      formula: round2(formulaPrice(lsp, st.last3, st.races)),
    };
  });
}

/**
 * Drivers and teams racing now who have no price yet (a rookie or a substitute): they start
 * at their price peer's price if a commissioner set one, otherwise at the cheapest price.
 */
async function newcomers(db: Db, seasonId: number, priced: PriceRow[], floor: number): Promise<PriceRow[]> {
  const havePerson = new Set(priced.map((r) => r.personId).filter(Boolean));
  const haveCons = new Set(priced.map((r) => r.constructorId).filter(Boolean));
  const active = await db.select({ personId: stints.personId }).from(stints).where(eq(stints.active, true));
  const cons = await db.select({ id: constructors.id }).from(constructors).where(eq(constructors.active, true));
  const peers = await db.select().from(pricePeers).where(eq(pricePeers.seasonId, seasonId));
  const priceOfPerson = (id: number) => priced.find((r) => r.personId === id)?.formula;
  const out: PriceRow[] = [];
  for (const id of new Set(active.map((a) => a.personId))) {
    if (havePerson.has(id)) continue;
    const peer = peers.find((p) => p.personId === id);
    const start = (peer && priceOfPerson(peer.peerPersonId)) ?? floor;
    out.push({ personId: id, constructorId: null, lastSeasonPrice: start, last3: 0, racesCounted: 0, formula: start });
  }
  for (const c of cons) {
    if (haveCons.has(c.id)) continue;
    out.push({ personId: null, constructorId: c.id, lastSeasonPrice: floor, last3: 0, racesCounted: 0, formula: floor });
  }
  return out;
}

/**
 * A driver or team that appears after the open race was priced (a substitute named mid-week)
 * gets a price straight away: their price peer's, otherwise the cheapest price above 1.
 * Only before the lock; returns how many were added.
 */
export async function priceMissing(db: Db, race: Race): Promise<number> {
  if (race.lockedAt) return 0;
  const rows = await db.select().from(assetPrices).where(eq(assetPrices.raceId, race.id));
  if (!rows.length) return 0; // not priced yet: the normal pricing covers everyone
  const priced: PriceRow[] = rows.map((r) => ({
    personId: r.personId,
    constructorId: r.constructorId,
    lastSeasonPrice: num(r.lastSeasonPrice),
    last3: num(r.last3),
    racesCounted: r.racesCounted ?? 0,
    formula: num(r.finalPrice),
  }));
  const flags = await activeFlags(db, priced);
  const above = priced.filter((r, i) => flags[i] && r.formula > 1).map((r) => r.formula);
  const floor = above.length ? Math.min(...above) : 1;
  const extra = await newcomers(db, race.seasonId, priced, floor);
  if (!extra.length) return 0;
  await db.insert(assetPrices).values(
    extra.map((r) => ({
      raceId: race.id,
      personId: r.personId,
      constructorId: r.constructorId,
      lastSeasonPrice: String(round2(r.lastSeasonPrice)),
      last3: "0",
      racesCounted: 0,
      formulaPrice: String(round2(r.formula)),
      finalPrice: String(round2(r.formula)),
    })),
  );
  return extra.length;
}

/** Which rows are still racing (a person with an active stint, an active constructor). */
async function activeFlags(db: Db, rows: PriceRow[]): Promise<boolean[]> {
  const persons = new Set(
    (await db.select({ id: stints.personId }).from(stints).where(eq(stints.active, true))).map((r) => r.id),
  );
  const cons = new Set(
    (await db.select({ id: constructors.id }).from(constructors).where(eq(constructors.active, true))).map((r) => r.id),
  );
  return rows.map((r) => (r.personId ? persons.has(r.personId) : cons.has(r.constructorId!)));
}

async function writePrices(db: Db, race: Race, rows: PriceRow[]) {
  const floored = applyFloor(
    rows.map((r) => r.formula),
    await activeFlags(db, rows),
  );
  await db.insert(assetPrices).values(
    rows.map((r, i) => ({
      raceId: race.id,
      personId: r.personId,
      constructorId: r.constructorId,
      lastSeasonPrice: String(r.lastSeasonPrice),
      last3: String(r.last3),
      racesCounted: r.racesCounted,
      formulaPrice: String(r.formula),
      finalPrice: String(round2(floored[i])),
    })),
  );
}

const cheapest = async (db: Db, rows: PriceRow[]) => {
  const act = await activeFlags(db, rows);
  const floored = applyFloor(
    rows.map((r) => r.formula),
    act,
  );
  return round2(Math.min(...floored.filter((x, i) => x > 1 && act[i])));
};

export async function priceNextRace(db: Db, finished: Race): Promise<{ race: string; priced: number } | null> {
  const [next] = await db
    .select()
    .from(races)
    .where(and(eq(races.seasonId, finished.seasonId), gt(races.round, finished.round), ne(races.status, "cancelled")))
    .orderBy(asc(races.round))
    .limit(1);
  if (!next) return null;
  const [{ n: existing }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assetPrices)
    .where(eq(assetPrices.raceId, next.id));
  if (existing > 0) return null;
  const rows = await pricesAfter(db, finished);
  if (!rows.length) return null;
  const all = [...rows, ...(await newcomers(db, next.seasonId, rows, await cheapest(db, rows)))];
  await writePrices(db, next, all);
  return { race: next.label, priced: all.length };
}

/**
 * Opening prices for a new season's first race. Each driver's and team's "last season price"
 * is the price the formula gives after the previous season's last race (the price they'd have
 * had for one more race); the first race uses it as is, as the sheet did. Newcomers start at
 * their price peer's price, or the cheapest price.
 */
export async function priceSeasonOpener(db: Db, seasonId: number): Promise<{ race: string; priced: number } | null> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  const [first] = await db
    .select()
    .from(races)
    .where(and(eq(races.seasonId, seasonId), ne(races.status, "cancelled")))
    .orderBy(asc(races.round))
    .limit(1);
  if (!season || !first) return null;
  const [{ n: existing }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assetPrices)
    .where(eq(assetPrices.raceId, first.id));
  if (existing > 0) return null;
  const [prev] = await db
    .select()
    .from(seasons)
    .where(sql`${seasons.year} < ${season.year}`)
    .orderBy(desc(seasons.year))
    .limit(1);
  if (!prev) return null;
  const [lastRace] = await db
    .select()
    .from(races)
    .where(and(eq(races.seasonId, prev.id), eq(races.results, "final"), ne(races.status, "cancelled")))
    .orderBy(desc(races.round))
    .limit(1);
  if (!lastRace) return null;
  const after = await pricesAfter(db, lastRace);
  if (!after.length) return null;
  // Season-end price (after the floor) becomes this season's last-season price.
  const ended = applyFloor(
    after.map((r) => r.formula),
    await activeFlags(db, after),
  ).map(round2);
  const rows: PriceRow[] = after.map((r, i) => ({
    personId: r.personId,
    constructorId: r.constructorId,
    lastSeasonPrice: ended[i],
    last3: 0,
    racesCounted: 0,
    formula: ended[i],
  }));
  const all = [...rows, ...(await newcomers(db, seasonId, rows, await cheapest(db, rows)))];
  await writePrices(db, first, all);
  return { race: first.label, priced: all.length };
}

/* ───────────────────────────── One run ───────────────────────────── */

export type RunResult = { sync?: SyncSummary; lock?: LockSummary | null; prices?: { race: string; priced: number } | null };

export type Sim = { name: string; xp: Record<string, number> };

const SNAPSHOT_EVERY = 30 * 60_000;

function simHash(xp: Record<string, number>) {
  return JSON.stringify(Object.keys(xp).sort().map((k) => [k, xp[k]]));
}

/**
 * Every 30 minutes before the deadline, keep f1fantasytools' expected points for the open race
 * if the analyst simulation changed since the last capture. Never throws.
 */
export async function captureXp(db: Db, race: Race, getXp: (round: number) => Promise<Sim | null>, now = new Date()) {
  if (race.lockedAt || !race.deadline || race.deadline <= now) return null;
  const key = `xp:${race.id}`;
  const [st] = await db.select().from(jobState).where(eq(jobState.key, key));
  if (st && now.getTime() - st.updatedAt.getTime() < SNAPSHOT_EVERY) return null;
  await db
    .insert(jobState)
    .values({ key, updatedAt: now })
    .onConflictDoUpdate({ target: jobState.key, set: { updatedAt: now } });
  let sim: Sim | null = null;
  try {
    sim = await getXp(race.round);
  } catch {
    return null;
  }
  if (!sim) return null;
  const hash = simHash(sim.xp);
  const [last] = await db
    .select({ hash: xpSnapshots.hash })
    .from(xpSnapshots)
    .where(eq(xpSnapshots.raceId, race.id))
    .orderBy(desc(xpSnapshots.capturedAt))
    .limit(1);
  if (last?.hash === hash) return null;
  const [row] = await db
    .insert(xpSnapshots)
    .values({ raceId: race.id, name: sim.name, xp: sim.xp, hash, capturedAt: now })
    .returning();
  return row;
}

/** The latest expected points captured before the race's deadline. */
export async function latestSnapshot(db: Db, race: Race) {
  const [row] = await db
    .select()
    .from(xpSnapshots)
    .where(
      and(eq(xpSnapshots.raceId, race.id), race.deadline ? lt(xpSnapshots.capturedAt, race.deadline) : sql`true`),
    )
    .orderBy(desc(xpSnapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Expected points for locking a race: f1fantasytools right now; if that fails, the last
 * capture before the deadline; if there is none, season points (the lock's own fallback).
 */
export async function xpForLock(db: Db, race: Race, getXp: (round: number) => Promise<Sim | null>) {
  let live: Sim | null = null;
  try {
    live = await getXp(race.round);
  } catch {
    live = null;
  }
  if (live) return { xp: live.xp, source: `f1fantasytools ${live.name} (read at the lock)` };
  const snap = await latestSnapshot(db, race);
  if (snap) {
    const at = snap.capturedAt.toLocaleString("en-CA", {
      timeZone: "America/Toronto",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    return { xp: snap.xp, source: `f1fantasytools ${snap.name} (captured ${at} ET)` };
  }
  return { xp: null, source: undefined };
}

/**
 * Everything the 5-minute job does, in order. `getXp` fetches f1fantasytools' analyst
 * simulation for a round (null when there is none or it can't be read).
 */
export async function runJob(
  db: Db,
  live: FftLive,
  getXp: (round: number) => Promise<Sim | null>,
  now = new Date(),
): Promise<RunResult> {
  const out: RunResult = {};
  out.sync = await syncFromFft(db, live);

  const cur = await currentRace(db);
  if (cur && !cur.lockedAt && cur.deadline && cur.deadline <= now) {
    const { xp, source } = await xpForLock(db, cur, getXp);
    out.lock = await lockRace(db, cur, xp, { now, xpSource: source });
  } else if (cur) {
    await priceMissing(db, cur);
    await captureXp(db, cur, getXp, now);
  }

  const [finished] = await db.select().from(races).where(eq(races.fftId, live.race.id)).limit(1);
  if (finished?.results === "final") out.prices = await priceNextRace(db, finished);
  // A new season's first race has no race before it in its season: price it from last season.
  const open = await currentRace(db);
  if (!out.prices && open && !open.lockedAt) out.prices = (await priceSeasonOpener(db, open.seasonId)) ?? undefined;
  return out;
}

/** Commissioner price import: lines like "VER 28.8" or rows pasted from the sheet (ticker first, price last). */
export async function importPrices(db: Db, race: Race, text: string): Promise<{ set: number; unknown: string[] }> {
  const ppl = await db.select().from(people);
  const cons = await db.select().from(constructors);
  const unknown: string[] = [];
  let set = 0;
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(/\t+|\s+/).filter(Boolean);
    if (cells.length < 2) continue;
    const ticker = cells[0].toUpperCase();
    // Header and divider rows from the sheet ("Driver / Constr", "Driver", "Constructor") are skipped.
    if (!/^[A-Z]{2,4}$/.test(ticker) || ["DRIVER", "CONSTR", "CONSTRUCTOR", "TYPE"].includes(ticker)) continue;
    const priceCell = [...cells].reverse().find((c) => /^-?\d+([.,]\d+)?$/.test(c));
    if (!priceCell) continue;
    const price = round2(Number(priceCell.replace(",", ".")));
    const p = ppl.find((x) => x.ticker === ticker);
    const c = cons.find((x) => x.ticker === ticker);
    if (!p && !c) {
      unknown.push(ticker);
      continue;
    }
    const values = { finalPrice: String(price), overridePrice: String(price) };
    if (p) {
      await db
        .insert(assetPrices)
        .values({ raceId: race.id, personId: p.id, ...values })
        .onConflictDoUpdate({ target: [assetPrices.raceId, assetPrices.personId], set: values });
    } else {
      await db
        .insert(assetPrices)
        .values({ raceId: race.id, constructorId: c!.id, ...values })
        .onConflictDoUpdate({ target: [assetPrices.raceId, assetPrices.constructorId], set: values });
    }
    set++;
  }
  return { set, unknown };
}

