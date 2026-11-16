import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import brazil from "./fixtures/fft-brazil.json";
import type { FftAsset, FftLive } from "@/lib/fft";
import { ensureBootstrapCommissioner, getLeague, joinAsNewPlayer } from "@/lib/league";
import { currentRace, savePicks, teamAssets } from "@/lib/team";
import { importPrices, lockRace, priceNextRace, runJob, syncFromFft } from "@/lib/sync";
import { makeUser, testDb } from "./helpers";

/** Brazil 2026 plus a few extra drivers so a full team (×2 + 4 drivers) is possible. */
function fixture(): FftLive {
  const live = structuredClone(brazil) as unknown as FftLive;
  const bor = live.drivers.find((d) => d.id === "AUD_BOR")!;
  const extra: [string, string, string][] = [
    ["AUD_HUL", "HUL", "AUD"],
    ["ALP_GAS", "GAS", "ALP"],
    ["ALP_COL", "COL", "ALP"],
  ];
  for (const [id, abbreviation, constructorId] of extra) {
    live.drivers.push({ ...(structuredClone(bor) as FftAsset), id, abbreviation, constructorId });
  }
  live.constructors.push({ ...live.constructors[0], id: "AUD", abbreviation: "AUD" });
  live.constructors.push({ ...live.constructors[0], id: "VRB", abbreviation: "VRB" });
  return live;
}

const PRICES = `VER\t28.8\nANT\t27.5\nLAW\t11.1\nBOR\t5.8\nHUL\t7.8\nGAS\t9.0\nCOL\t7.6\nMER\t34\nRED\t33.3\nALP\t18.2\nAUD\t11.6\nXYZ\t1`;

let db: Db;
let code: string;

beforeEach(async () => {
  db = await testDb();
  const t = await makeUser(db, "t@example.com", "Tomas");
  const me = await ensureBootstrapCommissioner(db, t, ["t@example.com"]);
  code = (await getLeague(db, me!.leagueId)).code;
});

describe("syncing from f1fantasytools", () => {
  it("creates the season, Brazil (final) and Vegas (next), assets and points", async () => {
    const res = await syncFromFft(db, fixture());
    expect(res).toMatchObject({ season: 2026, current: "R20 BRA", next: "R21 VEG", state: "final" });
    const rs = await db.select().from(s.races);
    const vegas = rs.find((r) => r.fftId === "2026_21")!;
    expect(vegas.deadline?.toISOString()).toBe("2026-11-21T04:00:00.000Z");
    expect(rs.find((r) => r.fftId === "2026_20")?.status).toBe("completed");

    const law = await db.select().from(s.people).where(eq(s.people.ticker, "LAW"));
    expect(law).toHaveLength(1); // one person, two stints
    const st = await db.select().from(s.stints).where(eq(s.stints.personId, law[0].id));
    expect(st.map((x) => [x.fftId, x.active])).toEqual(
      expect.arrayContaining([["RED_LAW", false], ["VRB_LAW", true]]),
    );
    const haas = await db.select().from(s.constructors).where(eq(s.constructors.ticker, "MER"));
    expect(haas[0].name).toBe("Mercedes");

    const pts = await db.select().from(s.assetPoints);
    expect(pts).toHaveLength(7 + 5); // active drivers + constructors; OCO and LAW@RED skipped
    const verStint = (await db.select().from(s.stints).where(eq(s.stints.fftId, "RED_VER")))[0];
    const ver = pts.find((p) => p.stintId === verStint.id)!;
    expect(Number(ver.total)).toBe(65);
    expect(ver.isFinal).toBe(true);
    expect(ver.breakdown).toMatchObject({ R: { dotdPit: 10 } });
  });

  it("is safe to run again and again", async () => {
    await syncFromFft(db, fixture());
    await syncFromFft(db, fixture());
    expect(await db.select().from(s.races)).toHaveLength(2);
    expect(await db.select().from(s.assetPoints)).toHaveLength(12);
    expect(await db.select().from(s.stints)).toHaveLength(8); // OCO skipped: no Haas in the fixture
  });

  it("moves the league on to Vegas once Brazil is final", async () => {
    await syncFromFft(db, fixture());
    expect((await currentRace(db))?.label).toBe("R21 VEG");
  });
});

describe("prices", () => {
  it("reads the Team Builder table pasted straight from the sheet", async () => {
    await syncFromFft(db, fixture());
    const vegas = (await currentRace(db))!;
    const sheet = [
      '"Driver /',
      'Constr"\tType\tSeason\tLast 3\tRaces\t2025 Price\tLast 3 Price\tNew Price',
      "VER\tDriver\t631\t141\t3\t53.26\t43.16\t43.16",
      "\tDriver\t\t\t\t\t\t20.00",
      "\tConstructor\t\t\t\t\t\t100.00",
      "MER\tConstructor\t1543\t181\t3\t68.87\t55.40\t55.40",
      "OCO\tAsset Inactive\t162\t19\t3\t9.79\t5.82\t5.82",
    ].join("\n");
    expect(await importPrices(db, vegas, sheet)).toEqual({ set: 3, unknown: [] });
    const assets = await teamAssets(db, vegas);
    expect(assets.find((a) => a.ticker === "VER")?.price).toBe(43.16);
    expect(assets.find((a) => a.ticker === "MER")?.price).toBe(55.4);
  });

  it("imports prices pasted from the sheet and reports unknown tickers", async () => {
    await syncFromFft(db, fixture());
    const vegas = (await currentRace(db))!;
    const r = await importPrices(db, vegas, PRICES);
    expect(r).toEqual({ set: 11, unknown: ["XYZ"] });
    const assets = await teamAssets(db, vegas);
    expect(assets.find((a) => a.ticker === "VER")?.price).toBe(28.8);
  });

  it("prices the next race with the league formula once a race is final", async () => {
    await syncFromFft(db, fixture());
    const [bra] = await db.select().from(s.races).where(eq(s.races.fftId, "2026_20"));
    await importPrices(db, bra, PRICES);
    const res = await priceNextRace(db, bra);
    // 11 priced from Brazil, plus 1 active asset with no price yet, which starts at the floor.
    expect(res).toEqual({ race: "R21 VEG", priced: 12 });
    const vegasId = (await db.select().from(s.races).where(eq(s.races.fftId, "2026_21")))[0].id;
    const vegasAssets = await teamAssets(db, (await db.select().from(s.races).where(eq(s.races.id, vegasId)))[0]);
    expect(vegasAssets.every((a) => a.price != null && a.price > 1)).toBe(true);
    const [ver] = await db.select().from(s.people).where(eq(s.people.ticker, "VER"));
    const [row] = await db.select().from(s.assetPrices).where(eq(s.assetPrices.personId, ver.id));
    // races = 1 (Brazil), Last 3 = 65: 0.34·65/1.089 + 0.66·28.8
    const vegasRow = (await db.select().from(s.assetPrices).where(eq(s.assetPrices.personId, ver.id))).find(
      (p) => p.raceId !== bra.id,
    )!;
    expect(Number(vegasRow.finalPrice)).toBeCloseTo(0.34 * (65 / 1.089) + 0.66 * 28.8, 2);
    expect(vegasRow.racesCounted).toBe(1);
    expect(row).toBeDefined();
    expect(await priceNextRace(db, bra)).toBeNull(); // never overwrites
  });
});

describe("locking at the deadline", () => {
  async function setup() {
    await syncFromFft(db, fixture());
    const vegas = (await currentRace(db))!;
    await importPrices(db, vegas, PRICES);
    const ids = Object.fromEntries((await teamAssets(db, vegas)).map((a) => [a.ticker, a.id]));
    const users = await Promise.all(["a", "b", "c"].map((x) => makeUser(db, `${x}@example.com`)));
    await Promise.all(users.map((u, i) => joinAsNewPlayer(db, u, code, ["Ana", "Beto", "Caro"][i])));
    const before = new Date("2026-11-20T00:00:00Z");
    // Ana: full team; Beto: two picks; Caro and Tomas: nothing.
    await savePicks(db, users[0].id, vegas.id, { double: ids.BOR, d1: ids.ANT, d2: ids.LAW, d3: ids.HUL, d4: ids.GAS, team: ids.AUD }, before);
    await savePicks(db, users[1].id, vegas.id, { double: ids.COL, team: ids.ALP }, before);
    return { vegas, ids, users };
  }

  it("keeps full teams, fills partial ones and gives empty ones a random top team", async () => {
    const { vegas, users } = await setup();
    const after = new Date("2026-11-21T04:05:00Z");
    const res = await lockRace(db, vegas, { RED_VER: 30, MER_ANT: 25, MER: 70 }, { now: after, rng: () => 0.5 });
    expect(res?.leagues[0]).toMatchObject({ kept: 1, autoFilled: 1, random: 2 });

    const all = await db.select().from(s.picks);
    const byPlayer = async (uid: string) => {
      const [p] = await db.select().from(s.players).where(eq(s.players.userId, uid));
      return all.find((x) => x.playerId === p.id)!;
    };
    const ana = await byPlayer(users[0].id);
    expect(ana.origin).toBe("manual");
    expect(Number(ana.frozenTeamPrice)).toBe(72.8);
    expect(ana.penalty).toBe(0);

    const beto = await byPlayer(users[1].id);
    expect(beto.origin).toBe("auto_filled");
    expect([beto.doubleStintId, beto.driver1StintId, beto.driver2StintId, beto.driver3StintId, beto.driver4StintId].every(Boolean)).toBe(true);
    expect(Number(beto.frozenTeamPrice)).toBeLessThanOrEqual(100);

    const randoms = all.filter((p) => p.origin === "random");
    expect(randoms).toHaveLength(2);
    const key = (p: (typeof all)[number]) =>
      [p.doubleStintId, [p.driver1StintId, p.driver2StintId, p.driver3StintId, p.driver4StintId].sort().join(), p.constructorId].join("|");
    expect(new Set(randoms.map(key)).size).toBe(2); // each no-show a different team
    expect(randoms.map(key)).not.toContain(key(ana)); // never identical to a submitted team

    const [locked] = await db.select().from(s.races).where(eq(s.races.id, vegas.id));
    expect(locked.lockedAt).not.toBeNull();
    const prices = await db.select().from(s.assetPrices).where(eq(s.assetPrices.raceId, vegas.id));
    expect(prices.every((p) => p.frozenAt)).toBe(true);
  });

  it("does nothing before the deadline, and only once", async () => {
    const { vegas } = await setup();
    expect(await lockRace(db, vegas, null, { now: new Date("2026-11-20T00:00:00Z") })).toBeNull();
    await lockRace(db, vegas, null, { now: new Date("2026-11-21T05:00:00Z") });
    const [again] = await db.select().from(s.races).where(eq(s.races.id, vegas.id));
    expect(await lockRace(db, again, null, { now: new Date("2026-11-21T06:00:00Z") })).toBeNull();
  });

  it("refuses to lock without prices", async () => {
    await syncFromFft(db, fixture());
    const vegas = (await currentRace(db))!;
    await expect(lockRace(db, vegas, null, { force: true })).rejects.toThrow(/No prices/);
  });
});

describe("a full job run", () => {
  it("syncs, locks when the deadline has passed, and prices nothing that already has prices", async () => {
    await syncFromFft(db, fixture());
    const vegas = (await currentRace(db))!;
    await importPrices(db, vegas, PRICES);
    let asked = 0;
    const res = await runJob(db, fixture(), async (round) => {
      asked = round;
      return null;
    }, new Date("2026-11-21T04:10:00Z"));
    expect(res.sync?.next).toBe("R21 VEG");
    expect(res.lock?.race).toBe("R21 VEG");
    expect(asked).toBe(21);
    expect(res.prices).toBeNull();
  });
});
