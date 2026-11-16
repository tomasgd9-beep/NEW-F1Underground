// The scheduled job's database work: keep races, assets and points in step
// with f1fantasytools, lock teams at the deadline, and price the next race.
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  assetPoints,
  assetPrices,
  constructors,
  leagues,
  people,
  picks,
  players,
  races,
  seasons,
  stints,
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
    const [u] = await db
      .update(races)
      .set({
        ...common,
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
      label: raceLabel(r),
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

export type LockSummary = { race: string; leagues: { name: string; kept: number; autoFilled: number; random: number }[] };

/**
 * At the deadline: fill partial teams, give empty ones a random top team,
 * record each team's frozen price and penalty, freeze prices, mark locked.
 * `xpByFft` are expected points keyed by f1fantasytools id ("RED_VER", "RED").
 */
export async function lockRace(
  db: Db,
  race: Race,
  xpByFft: Record<string, number> | null,
  opts: { now?: Date; force?: boolean; rng?: () => number; actor?: string } = {},
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
  opts: { rng?: () => number; actor?: string },
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

  const summary: LockSummary = { race: race.label, leagues: [] };
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
    await logActivity(db, opts.actor ?? "job", "teams_locked", { race: race.label, ...s }, { leagueId: lg.id });
  }

  await db.update(assetPrices).set({ frozenAt: now }).where(and(eq(assetPrices.raceId, race.id), isNull(assetPrices.frozenAt)));
  return summary;
}

/* ───────────────────────────── Prices ───────────────────────────── */

/**
 * Once a race is final, price the next race of the season with the league
 * formula, unless it already has prices (e.g. imported or set by hand).
 */
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

  const base = await db.select().from(assetPrices).where(eq(assetPrices.raceId, finished.id));
  if (!base.length) return null;

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

  const rows = base.map((b) => {
    const s = b.personId ? stat("personId", b.personId) : stat("constructorId", b.constructorId!);
    const lsp = num(b.lastSeasonPrice ?? b.finalPrice);
    return {
      raceId: next.id,
      personId: b.personId,
      constructorId: b.constructorId,
      lastSeasonPrice: String(lsp),
      last3: String(s.last3),
      racesCounted: s.races,
      formulaPrice: String(round2(formulaPrice(lsp, s.last3, s.races))),
    };
  });
  const floored = applyFloor(rows.map((r) => num(r.formulaPrice)));
  await db.insert(assetPrices).values(rows.map((r, i) => ({ ...r, finalPrice: String(round2(floored[i])) })));
  return { race: next.label, priced: rows.length };
}

/* ───────────────────────────── One run ───────────────────────────── */

export type RunResult = { sync?: SyncSummary; lock?: LockSummary | null; prices?: { race: string; priced: number } | null };

/**
 * Everything the 15-minute job does, in order. `getXp` fetches expected
 * points only when a lock actually happens.
 */
export async function runJob(
  db: Db,
  live: FftLive,
  getXp: (round: number) => Promise<Record<string, number> | null>,
  now = new Date(),
): Promise<RunResult> {
  const out: RunResult = {};
  out.sync = await syncFromFft(db, live);

  const cur = await currentRace(db);
  if (cur && !cur.lockedAt && cur.deadline && cur.deadline <= now) {
    out.lock = await lockRace(db, cur, await getXp(cur.round), { now });
  }

  const [finished] = await db.select().from(races).where(eq(races.fftId, live.race.id)).limit(1);
  if (finished?.results === "final") out.prices = await priceNextRace(db, finished);
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

