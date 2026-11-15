import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { ensureBootstrapCommissioner, getPlayerForUser } from "@/lib/league";
import { currentRace, myPicks, rowToPicks, savePicks, teamAssets } from "@/lib/team";
import { makeUser, testDb } from "./helpers";

const day = 864e5;
let db: Db;
let userId: string;
let ids: Record<string, number>;

/** A tiny grid: 2 teams, 3 drivers (LAW has two stints), 2 races. */
async function seed(deadlineOffsetMs: number) {
  const [season] = await db.insert(s.seasons).values({ year: 2027, status: "active" }).returning();
  const [r1, r2] = await db
    .insert(s.races)
    .values([
      { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australia", deadline: new Date(Date.now() - 7 * day), results: "final" },
      { seasonId: season.id, round: 2, label: "R02 CHN", name: "China", deadline: new Date(Date.now() + deadlineOffsetMs) },
    ])
    .returning();
  const [red, vrb] = await db
    .insert(s.constructors)
    .values([
      { ticker: "RED", name: "Red Bull", colour: "#3671C6" },
      { ticker: "VRB", name: "Racing Bulls", colour: "#6692FF" },
    ])
    .returning();
  const [ver, law, had] = await db
    .insert(s.people)
    .values([
      { ticker: "VER", fullName: "Max Verstappen" },
      { ticker: "LAW", fullName: "Liam Lawson" },
      { ticker: "HAD", fullName: "Isack Hadjar" },
    ])
    .returning();
  const [verS, lawOld, lawNow, hadS] = await db
    .insert(s.stints)
    .values([
      { personId: ver.id, constructorId: red.id },
      { personId: law.id, constructorId: red.id, firstRaceId: r1.id, lastRaceId: r1.id, active: false },
      { personId: law.id, constructorId: vrb.id, firstRaceId: r2.id },
      { personId: had.id, constructorId: red.id },
    ])
    .returning();
  await db.insert(s.assetPrices).values([
    { raceId: r1.id, personId: ver.id, finalPrice: "24.00" },
    { raceId: r2.id, personId: ver.id, finalPrice: "23.57" },
    { raceId: r1.id, personId: law.id, finalPrice: "15.30" },
    { raceId: r2.id, personId: law.id, finalPrice: "15.90" },
    { raceId: r1.id, personId: had.id, finalPrice: "7.35" },
    { raceId: r2.id, constructorId: red.id, finalPrice: "34.28" },
    { raceId: r2.id, constructorId: vrb.id, finalPrice: "31.53" },
  ]);
  await db.insert(s.assetPoints).values([
    { raceId: r1.id, stintId: lawOld.id, total: "12" },
    { raceId: r1.id, stintId: verS.id, total: "-3" },
    { raceId: r1.id, constructorId: red.id, total: "20" },
  ]);
  ids = { r1: r1.id, r2: r2.id, ver: verS.id, lawNow: lawNow.id, lawOld: lawOld.id, had: hadS.id, red: red.id };
}

beforeEach(async () => {
  db = await testDb();
  const u = await makeUser(db, "t@example.com", "T");
  userId = u.id;
  await ensureBootstrapCommissioner(db, u, ["t@example.com"]);
});

describe("current race and assets", () => {
  it("is the first race whose results aren't final", async () => {
    await seed(day);
    expect((await currentRace(db))?.label).toBe("R02 CHN");
  });

  it("lists current stints only, with prices, moves and person-level points", async () => {
    await seed(day);
    const race = (await currentRace(db))!;
    const assets = await teamAssets(db, race);
    const law = assets.find((a) => a.ticker === "LAW" && a.kind === "driver")!;
    expect(law.id).toBe(`s${ids.lawNow}`);
    expect(law.team).toBe("Racing Bulls");
    expect(law.price).toBe(15.9);
    expect(law.move).toBe(0.6);
    expect(law.season).toBe(12); // points scored at Red Bull still count for LAW
    expect(law.last3).toBe(12);
    const ver = assets.find((a) => a.ticker === "VER")!;
    expect(ver.season).toBe(-3); // negatives included
    const had = assets.find((a) => a.ticker === "HAD")!;
    expect(had.price).toBe(7.35); // falls back to the newest earlier price
    expect(had.move).toBeNull();
    expect(assets.filter((a) => a.ticker === "LAW")).toHaveLength(1);
  });
});

describe("saving a team", () => {
  it("saves and updates the same row", async () => {
    await seed(day);
    const res = await savePicks(db, userId, ids.r2, { double: `s${ids.lawNow}`, d1: `s${ids.ver}` });
    expect(res.price).toBe(39.47);
    expect(res.penalty).toBe(0);
    await savePicks(db, userId, ids.r2, { double: `s${ids.lawNow}`, d1: `s${ids.ver}`, team: `c${ids.red}` });
    const me = await getPlayerForUser(db, userId);
    const row = await myPicks(db, me!.id, ids.r2);
    expect(rowToPicks(row)).toMatchObject({ double: `s${ids.lawNow}`, d1: `s${ids.ver}`, team: `c${ids.red}` });
    expect(await db.select().from(s.picks)).toHaveLength(1);
  });

  it("reports the over-budget penalty but still saves", async () => {
    await seed(day);
    await db.update(s.assetPrices).set({ finalPrice: "70" }).where(eq(s.assetPrices.constructorId, ids.red));
    const res = await savePicks(db, userId, ids.r2, { d1: `s${ids.ver}`, d2: `s${ids.lawNow}`, team: `c${ids.red}` });
    expect(res.price).toBe(109.47);
    expect(res.penalty).toBe(-100);
  });

  it("refuses after the deadline, whatever the browser says", async () => {
    await seed(-60_000);
    await expect(savePicks(db, userId, ids.r2, { d1: `s${ids.ver}` })).rejects.toThrow(/deadline/);
  });

  it("refuses rule breaks and old stints", async () => {
    await seed(day);
    await expect(savePicks(db, userId, ids.r2, { double: `s${ids.ver}` })).rejects.toThrow(/rule/); // 23.57 ≥ 20
    await expect(savePicks(db, userId, ids.r2, { d1: `s${ids.lawOld}` })).rejects.toThrow(/rule/);
    await expect(savePicks(db, userId, ids.r2, { d1: `s${ids.ver}`, d2: `s${ids.ver}` })).rejects.toThrow(/rule/);
  });

  it("refuses a race that isn't the open one", async () => {
    await seed(day);
    await expect(savePicks(db, userId, ids.r1, { d1: `s${ids.ver}` })).rejects.toThrow(/isn't open/);
  });

  it("refuses non-members", async () => {
    await seed(day);
    const stranger = await makeUser(db, "x@example.com");
    await expect(savePicks(db, stranger.id, ids.r2, {})).rejects.toThrow(/members/);
  });
});
