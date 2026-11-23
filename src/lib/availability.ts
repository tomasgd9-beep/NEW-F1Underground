// Who's racing: a commissioner can take a driver or team out of the picker for one race
// ("not racing this weekend") or until turned back on ("inactive"); f1fantasytools' own
// active flag applies on top. Players whose saved team has someone taken out are emailed
// straight away. A saved pick that isn't swapped stays in the team and scores 0.
//
// Also here: the check for points that never arrived (a picked driver or team with no
// points once a race is final), shown on Admin and emailed to commissioners once.
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@/db";
import { assetOuts, assetPoints, constructors, jobState, people, picks, races, seasons, stints } from "@/db/schema";
import { LeagueError, logActivity, requireCommissioner } from "@/lib/league";
import { appUrl, escapeHtml, sendMail } from "@/lib/mail";
import { unsubscribeParts } from "@/lib/email-prefs";
import { canEmail, claim, deliver, etTime, recipients } from "@/lib/notify";
import { currentRace, isLocked } from "@/lib/team";

export type OutScope = "weekend" | "inactive";

export type OutRow = {
  id: number;
  key: string;
  ticker: string;
  scope: OutScope;
  raceLabel: string | null;
};

/** Everyone taken out by hand that still matters: this race's "not racing" and every "inactive". */
export async function listOuts(db: Db, raceId: number | null): Promise<OutRow[]> {
  const rows = await db
    .select({
      id: assetOuts.id,
      personId: assetOuts.personId,
      constructorId: assetOuts.constructorId,
      raceId: assetOuts.raceId,
      person: people.ticker,
      team: constructors.ticker,
      raceLabel: races.label,
    })
    .from(assetOuts)
    .leftJoin(people, eq(people.id, assetOuts.personId))
    .leftJoin(constructors, eq(constructors.id, assetOuts.constructorId))
    .leftJoin(races, eq(races.id, assetOuts.raceId))
    .where(raceId ? or(eq(assetOuts.raceId, raceId), isNull(assetOuts.raceId)) : isNull(assetOuts.raceId))
    .orderBy(desc(assetOuts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    key: r.personId ? `p${r.personId}` : `c${r.constructorId}`,
    ticker: r.person ?? r.team ?? "?",
    scope: r.raceId ? "weekend" : "inactive",
    raceLabel: r.raceLabel,
  }));
}

/** "p12" (a driver, all their stints) or "c3" (a team). */
function parseKey(key: string): { personId: number | null; constructorId: number | null } {
  const m = /^([pc])(\d+)$/.exec(key);
  if (!m) throw new LeagueError("Pick a driver or team.");
  return m[1] === "p" ? { personId: Number(m[2]), constructorId: null } : { personId: null, constructorId: Number(m[2]) };
}

/** Take a driver or team out of the open race (and, for "inactive", every race after it). */
export async function setOut(db: Db, userId: string, key: string, scope: OutScope, now = new Date()) {
  const me = await requireCommissioner(db, userId);
  const race = await currentRace(db);
  if (!race) throw new LeagueError("No race is open.");
  if (scope === "weekend" && isLocked(race, now)) {
    throw new LeagueError(`${race.label} is already locked; teams can't change any more.`);
  }
  const { personId, constructorId } = parseKey(key);
  const [name] = personId
    ? await db.select({ t: people.ticker }).from(people).where(eq(people.id, personId))
    : await db.select({ t: constructors.ticker }).from(constructors).where(eq(constructors.id, constructorId!));
  if (!name) throw new LeagueError("Pick a driver or team.");
  const same = personId ? eq(assetOuts.personId, personId) : eq(assetOuts.constructorId, constructorId!);
  const existing = await db
    .select()
    .from(assetOuts)
    .where(and(same, or(isNull(assetOuts.raceId), eq(assetOuts.raceId, race.id))));
  if (existing.some((e) => e.raceId == null)) throw new LeagueError(`${name.t} is already inactive.`);
  if (scope === "weekend" && existing.length) throw new LeagueError(`${name.t} is already out for ${race.label}.`);
  // Inactive replaces a this-race-only entry.
  if (scope === "inactive" && existing.length) {
    await db.delete(assetOuts).where(inArray(assetOuts.id, existing.map((e) => e.id)));
  }
  await db.insert(assetOuts).values({ personId, constructorId, raceId: scope === "weekend" ? race.id : null, setBy: userId });
  await logActivity(db, userId, "asset_out", { race: race.label, asset: name.t, scope }, { leagueId: me.leagueId });
  const emailed = isLocked(race, now) ? 0 : await emailAffected(db, race, key, name.t);
  return { ticker: name.t, race: race.label, emailed, affected: (await affectedPlayers(db, race.id, key)).length };
}

/** Put someone back in the picker. */
export async function clearOut(db: Db, userId: string, outId: number) {
  const me = await requireCommissioner(db, userId);
  const [row] = await db.select().from(assetOuts).where(eq(assetOuts.id, outId));
  if (!row) throw new LeagueError("Already back in.");
  await db.delete(assetOuts).where(eq(assetOuts.id, outId));
  const [name] = row.personId
    ? await db.select({ t: people.ticker }).from(people).where(eq(people.id, row.personId))
    : await db.select({ t: constructors.ticker }).from(constructors).where(eq(constructors.id, row.constructorId!));
  await logActivity(db, userId, "asset_back", { asset: name?.t }, { leagueId: me.leagueId });
  return name?.t ?? "";
}

/** Players whose saved team for a race includes the driver (any stint) or team. */
export async function affectedPlayers(db: Db, raceId: number, key: string): Promise<number[]> {
  const { personId, constructorId } = parseKey(key);
  const rows = await db.select().from(picks).where(eq(picks.raceId, raceId));
  if (constructorId) return rows.filter((r) => r.constructorId === constructorId).map((r) => r.playerId);
  const mine = new Set(
    (await db.select({ id: stints.id }).from(stints).where(eq(stints.personId, personId!))).map((s) => s.id),
  );
  return rows
    .filter((r) =>
      [r.doubleStintId, r.driver1StintId, r.driver2StintId, r.driver3StintId, r.driver4StintId].some(
        (v) => v != null && mine.has(v),
      ),
    )
    .map((r) => r.playerId);
}

export function outEmail(
  name: string,
  ticker: string,
  race: { label: string; name: string; deadline: Date | null },
  kind: "driver" | "constructor" = "driver",
) {
  const url = `${appUrl()}/team`;
  const by = race.deadline ? ` before the deadline (${etTime(race.deadline)})` : " before the deadline";
  const [it, It] = kind === "driver" ? ["him", "He"] : ["them", "They"];
  const line = `${ticker} won't race in the ${race.name}, and ${kind === "driver" ? "he's" : "they're"} in your saved team. Swap ${it} out${by}. If you don't, ${It.toLowerCase()} stay${kind === "driver" ? "s" : ""} in your team and score${kind === "driver" ? "s" : ""} 0.`;
  return {
    subject: `F1 Underground: ${ticker} isn't racing ${race.label} - swap ${it} out`,
    text: `Hi ${name},\n\n${line}\n\n${url}\n`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(line)}</p><p><a href="${url}">Fix my team</a></p>`,
  };
}

/** Email everyone whose saved team has the asset that was just taken out (once per asset per race). */
async function emailAffected(
  db: Db,
  race: { id: number; label: string; name: string; deadline: Date | null },
  key: string,
  ticker: string,
): Promise<number> {
  if (!canEmail()) return 0;
  const ids = new Set(await affectedPlayers(db, race.id, key));
  if (!ids.size) return 0;
  let sent = 0;
  for (const r of await recipients(db, "reminders")) {
    if (!ids.has(r.playerId)) continue;
    const type = `out:${key}`;
    if (!(await claim(db, r.playerId, race.id, type))) continue;
    const m = outEmail(r.name, ticker, race, key.startsWith("p") ? "driver" : "constructor");
    const foot = await unsubscribeParts(db, r.userId, "reminders");
    await deliver(db, r.playerId, race.id, type, () =>
      sendMail(r.email, m.subject, m.text + foot.text, m.html + foot.html, foot.extras),
    );
    sent++;
  }
  return sent;
}

/* ─────────────────────── Points that never arrived ─────────────────────── */

export type MissingPoints = { raceId: number; race: string; tickers: string[] };

/**
 * Picked drivers and teams with no points for a race that's final. Ones that weren't racing
 * (taken out by hand, or dropped by f1fantasytools) are expected to score 0 and aren't listed.
 */
export async function missingPoints(db: Db, raceId: number): Promise<MissingPoints | null> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race || race.results !== "final" || race.status === "cancelled") return null;
  const teams = await db.select().from(picks).where(eq(picks.raceId, race.id));
  if (!teams.length) return null;
  const stintIds = new Set<number>();
  const consIds = new Set<number>();
  for (const t of teams) {
    for (const v of [t.doubleStintId, t.driver1StintId, t.driver2StintId, t.driver3StintId, t.driver4StintId]) {
      if (v != null) stintIds.add(v);
    }
    if (t.constructorId != null) consIds.add(t.constructorId);
  }
  const pts = await db.select().from(assetPoints).where(eq(assetPoints.raceId, race.id));
  const scoredStints = new Set(pts.filter((p) => p.total != null).map((p) => p.stintId));
  const scoredCons = new Set(pts.filter((p) => p.total != null).map((p) => p.constructorId));
  const outs = await db
    .select()
    .from(assetOuts)
    .where(or(eq(assetOuts.raceId, race.id), isNull(assetOuts.raceId)));
  const outPeople = new Set(outs.map((o) => o.personId).filter((v) => v != null));
  const outCons = new Set(outs.map((o) => o.constructorId).filter((v) => v != null));

  const tickers: string[] = [];
  const stintRows = stintIds.size
    ? await db
        .select({ id: stints.id, personId: stints.personId, active: stints.active, lastRaceId: stints.lastRaceId, ticker: people.ticker })
        .from(stints)
        .innerJoin(people, eq(people.id, stints.personId))
        .where(inArray(stints.id, [...stintIds]))
    : [];
  for (const s of stintRows) {
    if (scoredStints.has(s.id) || outPeople.has(s.personId)) continue;
    // f1fantasytools dropped him at or before this race: not racing, 0 is right.
    if (!s.active && s.lastRaceId != null && s.lastRaceId !== race.id) continue;
    if (!s.active && s.lastRaceId === race.id) continue;
    tickers.push(s.ticker);
  }
  const consRows = consIds.size
    ? await db.select().from(constructors).where(inArray(constructors.id, [...consIds]))
    : [];
  for (const c of consRows) {
    if (scoredCons.has(c.id) || outCons.has(c.id) || !c.active) continue;
    tickers.push(c.ticker);
  }
  if (!tickers.length) return null;
  return { raceId: race.id, race: race.label, tickers: [...new Set(tickers)].sort() };
}

/** Missing points in the current season's final races (newest first), for Admin. */
export async function missingPointsThisSeason(db: Db, limit = 3): Promise<MissingPoints[]> {
  const [season] = await db.select().from(seasons).where(ne(seasons.status, "finished")).orderBy(desc(seasons.year)).limit(1);
  if (!season) return [];
  const finals = await db
    .select({ id: races.id })
    .from(races)
    .where(and(eq(races.seasonId, season.id), eq(races.results, "final")))
    .orderBy(desc(races.round))
    .limit(limit);
  const out: MissingPoints[] = [];
  for (const r of finals) {
    const m = await missingPoints(db, r.id);
    if (m) out.push(m);
  }
  return out;
}

/** Email the commissioners once per race when a final race has picked assets without points. */
export async function alertMissingPoints(db: Db, now = new Date()): Promise<number> {
  const found = await missingPointsThisSeason(db, 1);
  const m = found[0];
  if (!m || !canEmail()) return 0;
  const key = `missing_points:${m.raceId}:${m.tickers.join(",")}`;
  const done = await db.insert(jobState).values({ key, updatedAt: now }).onConflictDoNothing().returning();
  if (!done.length) return 0;
  const bosses = (await recipients(db, "commissioner")).filter((r) => r.role === "commissioner");
  const url = `${appUrl()}/admin#corrections`;
  const what = `No points found for ${m.tickers.join(", ")} in ${m.race}, although the race is final and players picked ${m.tickers.length > 1 ? "them" : "it"}.`;
  for (const b of bosses) {
    const foot = await unsubscribeParts(db, b.userId, "commissioner");
    await sendMail(
      b.email,
      `F1 Underground: points missing for ${m.tickers.join(", ")} in ${m.race}`,
      `Hi ${b.name},\n\n${what}\nIf ${m.tickers.length > 1 ? "they" : "it"} really scored, enter the points in Admin → Corrections → Correct points. If f1fantasytools names ${m.tickers.length > 1 ? "them" : "it"} differently, the link needs fixing.\n\n${url}\n${foot.text}`,
      undefined,
      foot.extras,
    );
  }
  await logActivity(db, "job", "missing_points", { race: m.race, tickers: m.tickers, sentTo: bosses.length });
  return bosses.length;
}
