// Commissioner fixes for when the real world (or f1fantasytools) doesn't go to plan:
// a race's deadline or status, a driver's points for a race, and a locked team.
// Every change is logged in the activity log.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPoints, picks, players, races, seasons } from "@/db/schema";
import { LeagueError, logActivity, requireCommissioner } from "@/lib/league";
import { budgetPenalty, lineupIssues, parseAssetId, SLOTS, teamPrice, type AssetId, type Picks } from "@/lib/lineup";
import { priceNextRace } from "@/lib/sync";
import { teamAssets, type Race } from "@/lib/team";

/** "2026-11-20T23:00" typed on the Admin page, read as Toronto time. */
export function torontoToUtc(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) throw new LeagueError("Use the date and time picker.");
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of Toronto at that moment (handles daylight saving).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asToronto = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess + (guess - asToronto));
}

/** The opposite, for the input's default value. */
export function utcToTorontoInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

async function raceById(db: Db, raceId: number): Promise<Race> {
  const [r] = await db.select().from(races).where(eq(races.id, raceId));
  if (!r) throw new LeagueError("Race not found.");
  return r;
}

export type RaceStatus = "scheduled" | "delayed" | "cancelled" | "relocated";

/**
 * Deadline and status. A deadline typed here sticks (the job stops updating it) until
 * "follow f1fantasytools" is chosen again. Cancelling a race skips it: it isn't scored,
 * and the next race opens with prices worked out from the last finished race.
 */
export async function updateRace(
  db: Db,
  userId: string,
  raceId: number,
  opts: { status: RaceStatus; deadline: Date | "auto" },
) {
  const me = await requireCommissioner(db, userId);
  const race = await raceById(db, raceId);
  if (race.results === "final" && opts.status === "cancelled") {
    throw new LeagueError("That race already has final results; it can't be cancelled.");
  }
  const set: Partial<typeof races.$inferInsert> = { status: opts.status };
  if (opts.deadline === "auto") set.deadlineManual = false;
  else {
    if (race.lockedAt) throw new LeagueError("Teams for that race are already locked; the deadline can't move.");
    set.deadline = opts.deadline;
    set.deadlineManual = true;
  }
  await db.update(races).set(set).where(eq(races.id, raceId));
  if (opts.status === "cancelled" && race.status !== "cancelled") {
    // Price the next race from the last finished one, if it has no prices yet.
    const [latest] = await db
      .select()
      .from(races)
      .where(and(eq(races.seasonId, race.seasonId), eq(races.results, "final")))
      .orderBy(desc(races.round))
      .limit(1);
    if (latest) await priceNextRace(db, latest);
  }
  await logActivity(
    db,
    userId,
    "race_updated",
    {
      race: race.label,
      status: opts.status,
      deadline: opts.deadline === "auto" ? "from f1fantasytools" : opts.deadline.toISOString(),
    },
    { leagueId: me.leagueId },
  );
}

/**
 * A driver's or constructor's points for one race, typed by a commissioner. Totals per
 * session; the sync job leaves the row alone from then on (until the correction is cleared).
 */
export async function setPoints(
  db: Db,
  userId: string,
  raceId: number,
  assetId: AssetId,
  totals: { S: number | null; Q: number; R: number },
) {
  const me = await requireCommissioner(db, userId);
  const race = await raceById(db, raceId);
  const a = parseAssetId(assetId);
  if (!a) throw new LeagueError("Pick a driver or constructor.");
  const key = a.kind === "driver" ? { stintId: a.num, constructorId: null } : { stintId: null, constructorId: a.num };
  const where = and(
    eq(assetPoints.raceId, raceId),
    a.kind === "driver" ? eq(assetPoints.stintId, a.num) : eq(assetPoints.constructorId, a.num),
  );
  const [row] = await db.select().from(assetPoints).where(where);
  const breakdown = structuredClone(row?.breakdown ?? {});
  if (totals.S != null) breakdown.S = { ...(breakdown.S ?? {}), total: totals.S };
  breakdown.Q = { ...(breakdown.Q ?? {}), total: totals.Q };
  breakdown.R = { ...(breakdown.R ?? {}), total: totals.R };
  const total = (totals.S ?? 0) + totals.Q + totals.R;
  const values = {
    breakdown,
    sprintTotal: totals.S == null ? null : String(totals.S),
    qualiTotal: String(totals.Q),
    raceTotal: String(totals.R),
    total: String(total),
    manual: true,
    isFinal: race.results === "final",
    updatedAt: new Date(),
  };
  if (row) await db.update(assetPoints).set(values).where(eq(assetPoints.id, row.id));
  else await db.insert(assetPoints).values({ raceId, ...key, ...values });
  await logActivity(
    db,
    userId,
    "points_corrected",
    { race: race.label, asset: assetId, before: row ? Number(row.total) : null, after: total },
    { leagueId: me.leagueId },
  );
}

/** Lets f1fantasytools update that row again on the next run. */
export async function clearPointsCorrection(db: Db, userId: string, raceId: number, assetId: AssetId) {
  const me = await requireCommissioner(db, userId);
  const a = parseAssetId(assetId);
  if (!a) throw new LeagueError("Pick a driver or constructor.");
  await db
    .update(assetPoints)
    .set({ manual: false })
    .where(
      and(
        eq(assetPoints.raceId, raceId),
        a.kind === "driver" ? eq(assetPoints.stintId, a.num) : eq(assetPoints.constructorId, a.num),
      ),
    );
  const race = await raceById(db, raceId);
  await logActivity(db, userId, "points_correction_cleared", { race: race.label, asset: assetId }, { leagueId: me.leagueId });
}

/**
 * Replace a player's team for a race that's already locked (a save that didn't go through,
 * a random team that should have been theirs). Same rules as saving; the price is the
 * race's frozen prices and the budget penalty is worked out again.
 */
export async function fixTeam(db: Db, userId: string, raceId: number, playerId: number, team: Picks) {
  const me = await requireCommissioner(db, userId);
  const race = await raceById(db, raceId);
  const [pl] = await db.select().from(players).where(and(eq(players.id, playerId), eq(players.leagueId, me.leagueId)));
  if (!pl) throw new LeagueError("That player isn't in your league.");
  const [season] = await db.select().from(seasons).where(eq(seasons.id, race.seasonId));
  const assets = await teamAssets(db, race);
  const byId = new Map(assets.map((x) => [x.id, x]));
  const clean: Picks = {};
  for (const s of SLOTS) if (team[s]) clean[s] = team[s];
  const issues = lineupIssues(clean, byId, Number(season.doubleCap));
  if (issues.length) throw new LeagueError("That team breaks a rule (same pick twice, or the ×2 driver is too expensive).");
  const price = teamPrice(clean, byId);
  const n = (id: AssetId | null | undefined) => (id ? parseAssetId(id)!.num : null);
  const values = {
    doubleStintId: n(clean.double),
    driver1StintId: n(clean.d1),
    driver2StintId: n(clean.d2),
    driver3StintId: n(clean.d3),
    driver4StintId: n(clean.d4),
    constructorId: n(clean.team),
    frozenTeamPrice: String(price),
    penalty: budgetPenalty(price, Number(season.budget)),
    scoreAdjust: 0,
    origin: "manual" as const,
  };
  await db
    .insert(picks)
    .values({ playerId, raceId, ...values, savedAt: new Date() })
    .onConflictDoUpdate({ target: [picks.playerId, picks.raceId], set: values });
  await logActivity(
    db,
    userId,
    "team_fixed",
    { race: race.label, player: pl.displayName, price, penalty: values.penalty },
    { leagueId: me.leagueId },
  );
}
