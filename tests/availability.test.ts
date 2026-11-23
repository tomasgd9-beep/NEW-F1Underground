import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { ensureBootstrapCommissioner, getPlayerForUser } from "@/lib/league";
import { clearOut, listOuts, missingPoints, outEmail, setOut } from "@/lib/availability";
import { closeRace } from "@/lib/corrections";
import { lineupIssues } from "@/lib/lineup";
import { pointsForRace } from "@/lib/points";
import { statusLines, teamStatus } from "@/lib/notify";
import { lockRace } from "@/lib/sync";
import { currentRace, savePicks, teamAssets } from "@/lib/team";
import { makeUser, testDb } from "./helpers";

const day = 864e5;
let db: Db;
let uid: string;
let ids: Record<string, number>;
const TICKERS = ["VER", "HAD", "LAW", "GAS", "ALB", "SAI"];

/** Two races (R01 final, R02 open), six drivers at RED, one team, prices for R02. */
async function seed() {
  const [season] = await db.insert(s.seasons).values({ year: 2027, status: "active" }).returning();
  const [r1, r2, r3] = await db
    .insert(s.races)
    .values([
      { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australia", deadline: new Date(Date.now() - 7 * day), lockedAt: new Date(Date.now() - 7 * day), results: "final" },
      { seasonId: season.id, round: 2, label: "R02 CHN", name: "China", deadline: new Date(Date.now() + day) },
      { seasonId: season.id, round: 3, label: "R03 JPN", name: "Japan", deadline: new Date(Date.now() + 8 * day) },
    ])
    .returning();
  const [red] = await db.insert(s.constructors).values({ ticker: "RED", name: "Red Bull" }).returning();
  const ppl = await db
    .insert(s.people)
    .values(TICKERS.map((t) => ({ ticker: t, fullName: t })))
    .returning();
  const st = await db
    .insert(s.stints)
    .values(ppl.map((p) => ({ personId: p.id, constructorId: red.id })))
    .returning();
  for (const r of [r1, r2]) {
    await db.insert(s.assetPrices).values([
      ...ppl.map((p, i) => ({ raceId: r.id, personId: p.id, finalPrice: String(i === 0 ? 25 : 8 + i) })),
      { raceId: r.id, constructorId: red.id, finalPrice: "20" },
    ]);
  }
  await db.insert(s.assetPoints).values([
    ...st.map((x, i) => ({ raceId: r1.id, stintId: x.id, total: String(10 + i), isFinal: true })),
    { raceId: r1.id, constructorId: red.id, total: "30", isFinal: true },
  ]);
  ids = { r1: r1.id, r2: r2.id, r3: r3.id, red: red.id };
  TICKERS.forEach((t, i) => {
    ids[t] = st[i].id;
    ids[`p${t}`] = ppl[i].id;
  });
}

const team = () => ({
  double: `s${ids.HAD}`,
  d1: `s${ids.VER}`,
  d2: `s${ids.LAW}`,
  d3: `s${ids.GAS}`,
  d4: `s${ids.ALB}`,
  team: `c${ids.red}`,
});

beforeEach(async () => {
  db = await testDb();
  const u = await makeUser(db, "t@example.com", "Tomas");
  uid = u.id;
  await ensureBootstrapCommissioner(db, u, ["t@example.com"]);
  await seed();
});

describe("not racing", () => {
  it("takes a driver out of this race only: hidden, can't be saved, flagged in a saved team", async () => {
    await savePicks(db, uid, ids.r2, team());
    const r = await setOut(db, uid, `p${ids.pLAW}`, "weekend");
    expect(r).toMatchObject({ ticker: "LAW", race: "R02 CHN", affected: 1 });

    const race = (await currentRace(db))!;
    const assets = await teamAssets(db, race);
    expect(assets.find((a) => a.ticker === "LAW")?.out).toBe("weekend");
    const byId = new Map(assets.map((a) => [a.id, a]));
    expect(lineupIssues(team(), byId).map((i) => i.code)).toEqual(["not_racing"]);
    await expect(savePicks(db, uid, ids.r2, team())).rejects.toThrow(/breaks a rule/);

    // The reminder says so.
    const me = (await getPlayerForUser(db, uid))!;
    const st = await teamStatus(db, me.id, race);
    expect(st.out).toEqual(["LAW"]);
    expect(statusLines(st).join(" ")).toMatch(/LAW isn't racing this weekend/);

    // Next race he's back.
    const r3 = (await db.select().from(s.races).where(eq(s.races.id, ids.r3)))[0];
    expect((await teamAssets(db, r3)).find((a) => a.ticker === "LAW")?.out).toBeUndefined();
  });

  it("inactive lasts until turned back on, and replaces a this-race entry", async () => {
    await setOut(db, uid, `p${ids.pSAI}`, "weekend");
    await setOut(db, uid, `p${ids.pSAI}`, "inactive");
    const outs = await listOuts(db, ids.r2);
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ ticker: "SAI", scope: "inactive" });
    const r3 = (await db.select().from(s.races).where(eq(s.races.id, ids.r3)))[0];
    expect((await teamAssets(db, r3)).find((a) => a.ticker === "SAI")?.out).toBe("inactive");
    await expect(setOut(db, uid, `p${ids.pSAI}`, "weekend")).rejects.toThrow(/already inactive/);
    await clearOut(db, uid, outs[0].id);
    expect((await teamAssets(db, r3)).find((a) => a.ticker === "SAI")?.out).toBeUndefined();
  });

  it("at the lock the saved pick stays (and isn't swapped by the auto-fill)", async () => {
    await savePicks(db, uid, ids.r2, team());
    await setOut(db, uid, `p${ids.pLAW}`, "weekend");
    const race = (await currentRace(db))!;
    await lockRace(db, race, null, { now: new Date(Date.now() + 2 * day) });
    const [p] = await db.select().from(s.picks).where(eq(s.picks.raceId, ids.r2));
    expect(p.origin).toBe("manual");
    expect(p.driver2StintId).toBe(ids.LAW);
  });

  it("the email tells them to swap him out", () => {
    const m = outEmail("Ana", "LAW", { label: "R02 CHN", name: "Chinese Grand Prix", deadline: null });
    expect(m.subject).toContain("LAW isn't racing R02 CHN");
    expect(m.text).toMatch(/stays in your team and scores 0/);
  });
});

describe("missing points", () => {
  it("lists picked assets without points once a race is final, not the ones that weren't racing", async () => {
    await savePicks(db, uid, ids.r2, team());
    await setOut(db, uid, `p${ids.pLAW}`, "weekend");
    await db
      .insert(s.assetPoints)
      .values([`HAD`, `VER`, `ALB`].map((t) => ({ raceId: ids.r2, stintId: ids[t], total: "5", isFinal: true })));
    await db.update(s.races).set({ results: "final", lockedAt: new Date() }).where(eq(s.races.id, ids.r2));
    const m = await missingPoints(db, ids.r2);
    expect(m?.tickers).toEqual(["GAS", "RED"]);
  });
});

describe("move to next race", () => {
  it("closes a locked race by hand and opens the next one, priced", async () => {
    const race = (await currentRace(db))!;
    await expect(closeRace(db, uid, race.id)).rejects.toThrow(/isn't locked/);
    await lockRace(db, race, null, { now: new Date(Date.now() + 2 * day) });
    await db.update(s.races).set({ results: "provisional" }).where(eq(s.races.id, race.id));
    const r = await closeRace(db, uid, race.id);
    expect(r).toMatchObject({ race: "R02 CHN", next: "R03 JPN" });
    expect(r.priced).toBeGreaterThan(0);
    const [after] = await db.select().from(s.races).where(eq(s.races.id, race.id));
    expect(after).toMatchObject({ results: "final", closedByHand: true });
    expect((await currentRace(db))!.label).toBe("R03 JPN");
  });
});

describe("points: as of and now", () => {
  it("an earlier race also carries the figures as they stand now", async () => {
    await db.insert(s.assetPoints).values({ raceId: ids.r2, stintId: ids.VER, total: "7" });
    await db.update(s.races).set({ results: "final" }).where(eq(s.races.id, ids.r2));
    const me = (await getPlayerForUser(db, uid))!;
    const old = await pointsForRace(db, ids.r1, me.leagueId);
    const ver = old.find((r) => r.ticker === "VER")!;
    expect(ver.season).toBe(10);
    expect(ver.now).toEqual({ season: 17, last3: 17, races: 2 });
    const latest = await pointsForRace(db, ids.r2, me.leagueId);
    expect(latest.find((r) => r.ticker === "VER")!.now).toBeNull();
  });
});
