// Replays the league's price formula on the imported 2026 season and checks it against the
// Las Vegas prices the spreadsheet produced, then opens a pretend 2027 season.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assetPrices, constructors, people, races, seasons } from "@/db/schema";
import { backfill2026 } from "@/lib/backfill";
import { priceNextRace, priceSeasonOpener } from "@/lib/sync";
import { testDb } from "./helpers";

const files = {
  races: readFileSync("data/2026-races.txt", "utf8"),
  points: readFileSync("data/2026-points.txt", "utf8"),
  teams: readFileSync("data/2026-teams.txt", "utf8"),
};

// From the sheet's Team Builder for R23 VEG.
const SHEET_VEGAS: Record<string, number> = {
  VER: 43.16, LEC: 30.3, HAM: 26.63, ANT: 26.32, NOR: 22.04, HAD: 17.45, RUS: 16.22, LAW: 13.16, PIA: 11.94,
  BOR: 11.02, PER: 7.04, ALB: 4.9, LIN: 4.59, HUL: 3.98, GAS: 3.06, ALO: 2.45, BEA: 2.45, BOT: 2.45, COL: 2.45,
  SAI: 2.45, STR: 2.45, RED: 68.26, FER: 66.12, MER: 55.4, MCL: 46.83, VRB: 30, AUD: 25.71, WIL: 15.3, ALP: 4.59,
  AST: 2.45, CAD: 2.45, HAA: 2.45,
};

async function pricesFor(db: Awaited<ReturnType<typeof testDb>>, raceId: number) {
  const rows = await db.select().from(assetPrices).where(eq(assetPrices.raceId, raceId));
  const ppl = await db.select().from(people);
  const cons = await db.select().from(constructors);
  return Object.fromEntries(
    rows.map((r) => [
      r.personId ? ppl.find((p) => p.id === r.personId)!.ticker : cons.find((c) => c.id === r.constructorId)!.ticker,
      Number(r.finalPrice),
    ]),
  );
}

describe("price formula replay", () => {
  it("gives the sheet's Vegas prices from the imported season", async () => {
    const db = await testDb();
    await backfill2026(db, files);
    const [s] = await db.select().from(seasons).where(eq(seasons.year, 2026));
    const [brazil] = await db.select().from(races).where(eq(races.fftId, "2026_20"));
    await db.insert(races).values({ seasonId: s.id, round: 21, fftId: "2026_21", label: "R23 VEG", name: "Las Vegas Grand Prix" });
    await priceNextRace(db, brazil);
    const [veg] = await db.select().from(races).where(eq(races.fftId, "2026_21"));
    const got = await pricesFor(db, veg.id);
    const off = Object.entries(SHEET_VEGAS).filter(([t, p]) => Math.abs((got[t] ?? -1) - p) > 0.011);
    expect(off.map(([t, p]) => `${t} sheet ${p} site ${got[t]}`)).toEqual([]);
  }, 120_000);

  it("opens a new season from last season's end-of-season prices", async () => {
    const db = await testDb();
    await backfill2026(db, files);
    const [s27] = await db.insert(seasons).values({ year: 2027, status: "active" }).returning();
    const [r1] = await db
      .insert(races)
      .values({ seasonId: s27.id, round: 1, fftId: "2027_1", label: "R01 AUS", name: "Australian Grand Prix" })
      .returning();
    const res = await priceSeasonOpener(db, s27.id);
    expect(res?.race).toBe("R01 AUS");
    const got = await pricesFor(db, r1.id);
    // Last 3 of 2026 (R20 USA, R21 MEX, R22 BRA) / 3 / 1.089: VER (27+49+65)/3/1.089
    expect(got.VER).toBeCloseTo(141 / 3 / 1.089, 2);
    expect(Math.min(...Object.values(got))).toBeGreaterThan(1);
  }, 120_000);
});
