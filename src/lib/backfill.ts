// One-off imports of seasons played on the spreadsheets: 2026 (R1 AUS → R22 BRA, then the
// site took over), and the finished 2025 and 2024 seasons, which are view-only.
// The sheet is the source of truth: driver/constructor points come from its Points
// tab, teams from its Scoring archive, and every player's race score is pinned to
// the sheet's season table (picks.scoreAdjust absorbs any difference).
// Safe to run more than once: everything is upserted, and a run with the same
// data is skipped via the activity log.
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  activityLog,
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
import { CONSTRUCTOR_NAMES, DRIVER_NAMES, type Breakdown } from "@/lib/fft";
import { logActivity } from "@/lib/league";
import { applyFloor, formulaPrice, round2 } from "@/lib/pricing";

/** Colours for teams f1fantasytools no longer lists (it supplies the rest). */
const PAST_COLOURS: Record<string, string> = { KCK: "#52E252" };

export type HistoryFiles = { races: string; points: string; teams: string };

type RaceRow = { round: number; label: string; name: string; country: string; sprint: boolean; times: Record<string, string> };
type AssetRow = { key: string; ticker: string; team: string; kind: "D" | "I" | "C"; lsp: number | null };
type PointRow = { round: number; key: string; parts: Breakdown; total: number };
type TeamRow = {
  round: number;
  player: string;
  x2: string;
  x1: string[];
  c: string;
  penalty: number;
  sheet: number | null;
  /** The team price the sheet recorded, when it did. */
  price: number | null;
};

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

export function parseHistory(f: HistoryFiles) {
  const raceRows: RaceRow[] = lines(f.races).map((l) => {
    const [round, sheetLabel, name, country, , sprint, ...rest] = l.split("|");
    const [n, code] = sheetLabel.replace(/^R/, "").split(" ");
    return {
      round: Number(round),
      label: `R${n.padStart(2, "0")} ${code}`,
      name,
      country,
      sprint: sprint === "1",
      times: JSON.parse(rest.join("|")) as Record<string, string>,
    };
  });

  const assets: AssetRow[] = [];
  const season = new Map<string, number[]>();
  const teams: TeamRow[] = [];
  for (const l of lines(f.teams)) {
    const p = l.split("|");
    if (p[0] === "A") assets.push({ key: p[1], ticker: p[2], team: p[3], kind: p[4] as AssetRow["kind"], lsp: p[5] ? Number(p[5]) : null });
    if (p[0] === "S") season.set(p[1], p[2].split(",").map(Number));
    if (p[0] === "T")
      teams.push({
        round: Number(p[1]),
        player: p[2],
        x2: p[3],
        x1: p[4] ? p[4].split(",") : [],
        c: p[5],
        penalty: Number(p[6]),
        sheet: /^-?\d+$/.test(p[7]) ? Number(p[7]) : null,
        price: p[8] && !Number.isNaN(Number(p[8])) && Number(p[8]) > 0 ? Number(p[8]) : null,
      });
  }

  const pts: PointRow[] = [];
  for (const l of lines(f.points)) {
    const [, round, key, body] = l.split("|");
    const groups = body.split("/").map((g) => g.split(",").map(Number));
    const total = groups.pop()![0];
    if (groups.every((g) => g.every((v) => v === 0)) && total === 0) continue; // didn't take part
    const parts: Breakdown = {};
    let i = 0;
    if (groups.length === 3) {
      const [pos, gained, overtakes, fastestLap, t] = groups[i++];
      parts.S = { pos, gained, overtakes, fastestLap, total: t };
    }
    const [qpos, team, qt] = groups[i++];
    parts.Q = { pos: qpos, team, total: qt };
    const [pos, gained, overtakes, fastestLap, dotdPit, rt] = groups[i++];
    parts.R = { pos, gained, overtakes, fastestLap, dotdPit, total: rt };
    pts.push({ round: Number(round), key, parts, total });
  }
  return { raceRows, assets, season, teams, pts };
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

export type BackfillResult = { skipped: boolean; races: number; points: number; teams: number; created: string[]; mismatches: string[] };

export async function backfill2026(db: Db, files: HistoryFiles, opts: { force?: boolean } = {}): Promise<BackfillResult> {
  return backfillSeason(db, 2026, files, { ...opts, prices: true, past: false });
}

/**
 * Import one season from its spreadsheet export.
 * `prices`: work out each race's driver and team prices with the league formula (2024's
 * prices weren't kept race by race, so it shows the sheet's team prices only).
 * `past`: a finished season. Its players, drivers and teams that aren't in the current season
 * are added as inactive, so nothing from it shows up in the current team builder.
 */
export async function backfillSeason(
  db: Db,
  year: number,
  files: HistoryFiles,
  opts: { force?: boolean; prices: boolean; past: boolean },
): Promise<BackfillResult> {
  const action = `backfill_${year}`;
  const hash = createHash("sha256").update(files.races + files.points + files.teams).digest("hex").slice(0, 16);
  if (!opts.force) {
    const done = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(and(eq(activityLog.action, action), sql`${activityLog.detail}->>'hash' = ${hash}`))
      .limit(1);
    if (done.length) return { skipped: true, races: 0, points: 0, teams: 0, created: [], mismatches: [] };
  }

  const { raceRows, assets, season, teams, pts } = parseHistory(files);
  const [league] = await db.select().from(leagues).orderBy(leagues.id).limit(1);
  if (!league) throw new Error("No league yet");

  // Season
  let [s] = await db.select().from(seasons).where(eq(seasons.year, year));
  if (!s) [s] = await db.insert(seasons).values({ year, status: opts.past ? "finished" : "active" }).returning();

  // Races
  const raceId = new Map<number, number>();
  for (const r of raceRows) {
    const deadline = new Date(r.sprint && r.times.sprint ? r.times.sprint : r.times.qualifying);
    const values = {
      label: r.label,
      name: r.name,
      country: r.country,
      isSprint: r.sprint,
      sessionTimes: r.times,
      deadline,
      status: "completed" as const,
      results: "final" as const,
    };
    const fftId = `${year}_${r.round}`;
    const [existing] = await db.select().from(races).where(eq(races.fftId, fftId)).limit(1);
    if (existing) {
      await db
        .update(races)
        .set({ ...values, lockedAt: existing.lockedAt ?? deadline })
        .where(eq(races.id, existing.id));
      raceId.set(r.round, existing.id);
    } else {
      const [c] = await db
        .insert(races)
        .values({ seasonId: s.id, round: r.round, fftId, lockedAt: deadline, ...values })
        .returning({ id: races.id });
      raceId.set(r.round, c.id);
    }
  }

  // Constructors, people, stints
  const consId = new Map<string, number>();
  for (const t of new Set(assets.map((a) => a.team))) {
    const [c] = await db
      .insert(constructors)
      // A team that only existed in a past season (Kick Sauber) is added as inactive.
      .values({
        ticker: t,
        name: CONSTRUCTOR_NAMES[t] ?? t,
        ...(PAST_COLOURS[t] ? { colour: PAST_COLOURS[t] } : {}),
        ...(opts.past ? { active: false } : {}),
      })
      .onConflictDoUpdate({ target: constructors.ticker, set: { ticker: t } })
      .returning({ id: constructors.id });
    consId.set(t, c.id);
  }
  const firstLast = (key: string) => {
    const rs = pts.filter((p) => p.key === key).map((p) => p.round);
    return rs.length ? [Math.min(...rs), Math.max(...rs)] : [raceRows[0].round, raceRows.at(-1)!.round];
  };
  const stintId = new Map<string, number>();
  const personOf = new Map<string, number>();
  for (const a of assets.filter((x) => x.kind !== "C")) {
    const [person] = await db
      .insert(people)
      .values({ ticker: a.ticker, fullName: DRIVER_NAMES[a.ticker] ?? a.ticker })
      .onConflictDoUpdate({
        target: people.ticker,
        set: { fullName: sql`case when ${people.fullName} = ${people.ticker} then excluded.full_name else ${people.fullName} end` },
      })
      .returning({ id: people.id });
    personOf.set(a.key, person.id);
    const fftId = `${a.team}_${a.ticker}`;
    const cid = consId.get(a.team)!;
    const [existing] = await db
      .select()
      .from(stints)
      .where(sql`${stints.fftId} = ${fftId} or (${stints.personId} = ${person.id} and ${stints.constructorId} = ${cid})`)
      .limit(1);
    const [first, last] = firstLast(a.key);
    if (existing) {
      stintId.set(a.key, existing.id);
      // A past season never changes a stint the current season uses.
      if (!opts.past && (!existing.firstRaceId || existing.firstRaceId !== raceId.get(first))) {
        await db.update(stints).set({ firstRaceId: raceId.get(first) }).where(eq(stints.id, existing.id));
      }
    } else {
      const [c] = await db
        .insert(stints)
        .values({
          personId: person.id,
          constructorId: cid,
          fftId,
          firstRaceId: raceId.get(first),
          lastRaceId: a.kind === "I" || opts.past ? raceId.get(last) : null,
          active: a.kind !== "I" && !opts.past,
        })
        .returning({ id: stints.id });
      stintId.set(a.key, c.id);
    }
  }
  const assetId = (key: string) => {
    if (!key) return { stintId: null, constructorId: null, id: "" };
    const a = assets.find((x) => x.key === key);
    if (!a) throw new Error(`Unknown asset ${key}`);
    return a.kind === "C" ? { constructorId: consId.get(a.team)!, id: `c${consId.get(a.team)}` } : { stintId: stintId.get(key)!, id: `s${stintId.get(key)}` };
  };

  // Points (replace whatever the live sync wrote for these races)
  const allRaceIds = [...raceId.values()];
  await db.delete(assetPoints).where(inArray(assetPoints.raceId, allRaceIds));
  const ptRows = pts.map((p) => {
    const a = assetId(p.key);
    return {
      raceId: raceId.get(p.round)!,
      stintId: a.stintId ?? null,
      constructorId: a.constructorId ?? null,
      breakdown: p.parts as Record<string, Record<string, number>>,
      sprintTotal: p.parts.S ? String(p.parts.S.total) : null,
      qualiTotal: String(p.parts.Q!.total),
      raceTotal: String(p.parts.R!.total),
      total: String(p.total),
      isFinal: true,
    };
  });
  for (let i = 0; i < ptRows.length; i += 200) await db.insert(assetPoints).values(ptRows.slice(i, i + 200));
  const pointOf = new Map(pts.map((p) => [`${p.round}|${p.key}`, p.total]));

  // Prices before each race (the league formula), unless a race already has prices
  const priced = await db
    .select({ raceId: assetPrices.raceId })
    .from(assetPrices)
    .where(inArray(assetPrices.raceId, allRaceIds));
  const pricedIds = new Set(priced.map((p) => p.raceId));
  const rounds = raceRows.map((r) => r.round);
  const priceOf = new Map<string, number>(); // `${round}|p<personId>` / `${round}|c<consId>`
  const priceUnits = [
    ...[...new Set(assets.filter((a) => a.kind !== "C").map((a) => a.ticker))].map((t) => {
      const keys = assets.filter((a) => a.ticker === t && a.kind !== "C").map((a) => a.key);
      const lsp = assets.find((a) => a.ticker === t && a.lsp != null)?.lsp ?? 0;
      return { unit: `p${personOf.get(keys[0])}`, keys, lsp, personId: personOf.get(keys[0])!, constructorId: null as number | null };
    }),
    ...assets
      .filter((a) => a.kind === "C")
      .map((a) => ({ unit: `c${consId.get(a.team)}`, keys: [a.key], lsp: a.lsp ?? 0, personId: null as number | null, constructorId: consId.get(a.team)! })),
  ];
  for (const [i, round] of rounds.entries()) {
    const before = rounds.slice(0, i);
    const last3 = before.slice(-3);
    const rows = priceUnits.map((u) => {
      const racedIn = before.filter((r) => u.keys.some((k) => pointOf.has(`${r}|${k}`))).length;
      const l3 = last3.reduce((sum, r) => sum + u.keys.reduce((s2, k) => s2 + (pointOf.get(`${r}|${k}`) ?? 0), 0), 0);
      const races = Math.min(3, racedIn);
      return { u, l3, races, formula: round2(formulaPrice(u.lsp, l3, races)) };
    });
    const floored = applyFloor(rows.map((r) => r.formula)).map(round2);
    rows.forEach((r, j) => priceOf.set(`${round}|${r.u.unit}`, floored[j]));
    const rid = raceId.get(round)!;
    if (pricedIds.has(rid) || !opts.prices) continue;
    await db.insert(assetPrices).values(
      rows.map((r, j) => ({
        raceId: rid,
        personId: r.u.personId,
        constructorId: r.u.constructorId,
        lastSeasonPrice: String(r.u.lsp),
        last3: String(r.l3),
        racesCounted: r.races,
        formulaPrice: String(r.formula),
        finalPrice: String(floored[j]),
        frozenAt: new Date(),
      })),
    );
  }

  // Players: match by first name, otherwise create an unlinked profile
  const existingPlayers = await db.select().from(players).where(eq(players.leagueId, league.id));
  const playerId = new Map<string, number>();
  const created: string[] = [];
  for (const name of new Set(teams.map((t) => t.player))) {
    const hits = existingPlayers.filter((p) => fold(p.displayName) === fold(name) || fold(p.displayName).split(/\s+/)[0] === fold(name));
    if (hits.length === 1) {
      playerId.set(name, hits[0].id);
      continue;
    }
    // Someone who only played a past season gets an inactive profile: no teams, no emails.
    const [p] = await db
      .insert(players)
      .values({ leagueId: league.id, displayName: name, ...(opts.past ? { active: false } : {}) })
      .returning({ id: players.id });
    playerId.set(name, p.id);
    created.push(name);
  }

  // Teams, with each race's score pinned to the sheet's season table
  const pids = [...playerId.values()];
  await db.delete(picks).where(and(inArray(picks.raceId, allRaceIds), inArray(picks.playerId, pids)));
  const mismatches: string[] = [];
  const pickRows = teams.map((t) => {
    const unit = (key: string) => {
      if (!key) return "";
      const a = assets.find((x) => x.key === key)!;
      return a.kind === "C" ? `c${consId.get(a.team)}` : `p${personOf.get(key)}`;
    };
    const keys = [t.x2, ...t.x1, t.c].filter(Boolean);
    const price = t.price ?? keys.reduce((sum, k) => sum + (priceOf.get(`${t.round}|${unit(k)}`) ?? 0), 0);
    const raw = 2 * (pointOf.get(`${t.round}|${t.x2}`) ?? 0) + t.x1.reduce((sum, k) => sum + (pointOf.get(`${t.round}|${k}`) ?? 0), 0) + (pointOf.get(`${t.round}|${t.c}`) ?? 0);
    const roundIdx = raceRows.findIndex((r) => r.round === t.round);
    const target = season.get(t.player)?.[roundIdx] ?? t.sheet ?? raw + t.penalty;
    const adjust = target - raw - t.penalty;
    if (adjust) mismatches.push(`${raceRows[roundIdx].label} ${t.player}: ${adjust > 0 ? "+" : ""}${adjust}`);
    const d = t.x1.map((k) => assetId(k).stintId ?? null);
    return {
      playerId: playerId.get(t.player)!,
      raceId: raceId.get(t.round)!,
      doubleStintId: assetId(t.x2).stintId ?? null,
      driver1StintId: d[0] ?? null,
      driver2StintId: d[1] ?? null,
      driver3StintId: d[2] ?? null,
      driver4StintId: d[3] ?? null,
      constructorId: assetId(t.c).constructorId ?? null,
      frozenTeamPrice: price ? String(round2(price)) : null,
      penalty: t.penalty,
      scoreAdjust: adjust,
      origin: "manual" as const,
      savedAt: new Date(raceRows[roundIdx].times.qualifying),
    };
  });
  for (let i = 0; i < pickRows.length; i += 100) await db.insert(picks).values(pickRows.slice(i, i + 100));

  // Everyone in the sheet played from R1, so none of them "joined" mid-season.
  if (!opts.past) await db.update(players).set({ joinedAtRaceId: null }).where(inArray(players.id, pids));

  await logActivity(
    db,
    "job",
    action,
    { hash, races: raceRows.length, points: ptRows.length, teams: pickRows.length, created, mismatches },
    { leagueId: league.id },
  );
  return { skipped: false, races: raceRows.length, points: ptRows.length, teams: pickRows.length, created, mismatches };
}
