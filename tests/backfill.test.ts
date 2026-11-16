import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leagues, picks, players, races } from "@/db/schema";
import { backfill2026, parseHistory, type HistoryFiles } from "@/lib/backfill";
import { loadLeague } from "@/lib/league-data";
import { standings, teamScore } from "@/lib/standings";
import { testDb } from "./helpers";

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
