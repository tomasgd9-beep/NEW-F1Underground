import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leagues, picks, players, races, seasons } from "@/db/schema";
import { backfill2026, backfillSeason, parseHistory, type HistoryFiles } from "@/lib/backfill";
import { setPoints } from "@/lib/corrections";
import { loadLeague } from "@/lib/league-data";
import { standings, teamScore } from "@/lib/standings";
import { makeUser, testDb } from "./helpers";
import { ensureBootstrapCommissioner } from "@/lib/league";

const files: HistoryFiles = {
  races: readFileSync("data/2026-races.txt", "utf8"),
  points: readFileSync("data/2026-points.txt", "utf8"),
  teams: readFileSync("data/2026-teams.txt", "utf8"),
};

describe("2026 backfill", () => {
  it("parses the sheet export", () => {
    const h = parseHistory(files);
    expect(h.raceRows).toHaveLength(20);
    expect(h.raceRows[3].label).toBe("R06 USA");
    expect(h.teams).toHaveLength(220);
    expect(h.season.get("Alonso")!.reduce((a, b) => a + b, 0)).toBe(3797);
    // Session parts add up to the total everywhere but one sheet cell (HAM, Monaco).
    const off = h.pts.filter((p) => (p.parts.S?.total ?? 0) + p.parts.Q!.total + p.parts.R!.total !== p.total);
    expect(off.map((p) => `${p.round}${p.key}`)).toEqual(["6HAM"]);
  }, 30_000);

  it("imports races, points and teams so standings match the sheet", async () => {
    const db = await testDb();
    const [league] = await db.select().from(leagues);
    const [tomas] = await db.insert(players).values({ leagueId: league.id, displayName: "Tomas Garcia" }).returning();

    const r = await backfill2026(db, files);
    expect(r.skipped).toBe(false);
    expect(r.races).toBe(20);
    expect(r.teams).toBe(220);
    expect(r.created).not.toContain("Tomas");
    expect(r.created).toHaveLength(10);

    const data = (await loadLeague(db, league.id, tomas.id))!;
    expect(data.races.map((x) => x.label).slice(0, 4)).toEqual(["R01 AUS", "R02 CHN", "R03 JPN", "R06 USA"]);
    const raceIds = data.races.map((x) => x.id);
    const rows = standings(
      data.players.map((p) => p.id),
      raceIds,
      (pid, rid) => {
        const t = data.teams[rid]?.[pid];
        return t ? teamScore(t, data.points[rid]) : null;
      },
    );
    const name = (id: number) => data.players.find((p) => p.id === id)!.name;
    const table = Object.fromEntries(rows.map((x) => [name(x.playerId), x.total]));
    expect(table).toEqual({
      Alonso: 3797,
      Gioacchino: 3600,
      "Tomas Garcia": 3577,
      Joaquin: 3512,
      Gianluca: 3392,
      Mikael: 3353,
      Franco: 3240,
      Salvatore: 3230,
      Ana: 3219,
      Paolo: 2992,
      Marcelo: 2908,
    });
    expect(rows[0].rank).toBe(1);

    // A second run with the same data does nothing; a forced one changes nothing.
    expect((await backfill2026(db, files)).skipped).toBe(true);
    await backfill2026(db, files, { force: true });
    expect(await db.select().from(picks)).toHaveLength(220);
    expect((await db.select().from(races)).every((x) => x.results === "final" && x.lockedAt)).toBe(true);
    expect(await db.select().from(players).where(eq(players.leagueId, league.id))).toHaveLength(11);
  }, 120_000);
});

const seasonFiles = (year: number): HistoryFiles => ({
  races: readFileSync(`data/${year}-races.txt`, "utf8"),
  points: readFileSync(`data/${year}-points.txt`, "utf8"),
  teams: readFileSync(`data/${year}-teams.txt`, "utf8"),
});

describe("past seasons (2025, 2024)", () => {
  it("import view-only, with standings exactly as the sheets, and leave 2026 alone", async () => {
    const db = await testDb();
    const [league] = await db.select().from(leagues);
    const [tomas] = await db.insert(players).values({ leagueId: league.id, displayName: "Tomas" }).returning();
    await backfill2026(db, files);
    const r25 = await backfillSeason(db, 2025, seasonFiles(2025), { prices: true, past: true });
    const r24 = await backfillSeason(db, 2024, seasonFiles(2024), { prices: false, past: true });
    expect([r25.races, r25.teams, r24.races, r24.teams]).toEqual([24, 240, 24, 272]);
    // Only the two who played 2024 alone are new, and they're inactive.
    expect(r25.created).toEqual([]);
    expect(r24.created.sort()).toEqual(["Claudia", "Harry"]);
    const ps = await db.select().from(players).where(eq(players.leagueId, league.id));
    expect(ps.filter((p) => !p.active).map((p) => p.displayName).sort()).toEqual(["Claudia", "Harry"]);

    const table = async (year: number) => {
      const all = await db.select().from(seasons);
      const s = all.find((x) => x.year === year)!;
      const data = (await loadLeague(db, league.id, tomas.id, s.id))!;
      const rows = standings(
        data.players.map((p) => p.id),
        data.races.map((x) => x.id),
        (pid, rid) => {
          const t = data.teams[rid]?.[pid];
          return t ? teamScore(t, data.points[rid]) : null;
        },
      );
      return Object.fromEntries(rows.map((x) => [data.players.find((p) => p.id === x.playerId)!.name, x.total]));
    };
    expect(await table(2025)).toEqual({
      Joaquin: 3587,
      Tomas: 3561,
      Ana: 3485,
      Gianluca: 3418,
      Gioacchino: 3333,
      Salvatore: 3308,
      Alonso: 3298,
      Mikael: 3083,
      Franco: 3063,
      Paolo: 3056,
    });
    expect(await table(2024)).toEqual({
      Tomas: 3692,
      Alonso: 3597,
      Paolo: 3574,
      Gianluca: 3479,
      Ana: 3477,
      Joaquin: 3473,
      Gioacchino: 3408,
      Salvatore: 3277,
      Mikael: 3267,
      Harry: 2048,
      Franco: 1889,
      Marcelo: 1742,
      Claudia: 1695,
    });
    // 2026 is untouched, and the 2024-only players don't show up in it.
    const t26 = await table(2026);
    expect(t26.Alonso).toBe(3797);
    expect(t26.Harry).toBeUndefined();

    // Past seasons can't be corrected.
    const [old] = await db.select().from(races).where(eq(races.fftId, "2025_1"));
    const u = await makeUser(db, "t@example.com", "Tomas");
    await ensureBootstrapCommissioner(db, u, ["t@example.com"]);
    await expect(setPoints(db, u.id, old.id, "s1", { S: null, Q: 1, R: 1 })).rejects.toThrow(/finished/);
  }, 240_000);
});
