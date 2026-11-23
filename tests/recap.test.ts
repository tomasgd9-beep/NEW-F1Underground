import { describe, expect, it } from "vitest";
import { buildRecap, lockTime } from "@/lib/recap";
import { recapEmail, recapSubject } from "@/lib/recap-email";
import { shareImage, SHARE_KINDS } from "@/lib/share-images";
import { orderPicks } from "@/lib/standings";
import { vegasLike } from "./recap-fixture";

describe("pick order", () => {
  it("puts the ×2 driver first, then drivers by points, then the constructor", () => {
    const out = orderPicks(
      [
        { assetId: "c1", slot: "c" },
        { assetId: "s1", slot: "d" },
        { assetId: "s2", slot: "x2" },
        { assetId: "s3", slot: "d" },
      ],
      { c1: 100, s1: 5, s2: 3, s3: 40 },
    );
    expect(out.map((p) => [p.assetId, p.v])).toEqual([["s2", 6], ["s3", 40], ["s1", 5], ["c1", 100]]);
  });
});

describe("weekend recap", () => {
  const recap = buildRecap(vegasLike(), 3)!;

  it("ranks the race and the season", () => {
    expect(recap.podium.map((p) => [p.rank, p.name, p.total])).toEqual([[1, "Ana", 306], [2, "Paolo", 271], [3, "Joaquin", 259]]);
    expect(recap.raceRows.find((r) => r.name === "Alonso")).toMatchObject({ total: 196, origin: "random", penalty: -10 });
    expect(recap.raceRows[0].chips.map((c) => c.ticker)).toEqual(["PIA", "ANT", "SAI", "GAS", "PER", "MCL"]);
    expect(recap.season[0]).toMatchObject({ name: "Joaquin", total: 839, move: 1 });
  });

  it("finds the highlights (no random-team line)", () => {
    const h = Object.fromEntries(recap.highlights.map((x) => [x.key, x]));
    expect(h.pick).toMatchObject({ text: "PIA ×2 · 114", detail: "Ana and Paolo" });
    expect(h.solo).toMatchObject({ text: "MCL · 113", detail: "only Ana" });
    expect(h.flop.text).toBe("ALB · −20");
    expect(h.mover.text).toBe("Joaquin up 1 to P1");
    expect(h.fight).toMatchObject({ text: "Gianluca 559 vs Paolo 541", detail: "P5 and P6, 18 points apart" });
    expect(recap.highlights.some((x) => /random/i.test(x.label))).toBe(false);
    expect(recap.next?.label).toBe("R24 QAT");
  });

  it("draws the graph as the gap to the current leader", () => {
    const leader = recap.graph.series.find((s) => s.playerId === recap.graph.leaderId)!;
    expect(leader.values).toEqual([0, 0, 0]);
    expect(recap.graph.series.find((s) => s.name === "Marcelo")!.values.at(-1)).toBe(430 - 839);
  });

  it("writes the lock time for Toronto and Lima", () => {
    expect(lockTime("2026-11-28T13:30:00Z")).toBe("Sat, Nov 28, 8:30 AM Toronto / Lima");
    expect(lockTime("2026-07-04T13:30:00Z")).toBe("Sat, Jul 4, 9:30 AM Toronto · 8:30 AM Lima");
  });

  it("builds a personal email with the tables and the next race", () => {
    const mail = recapEmail(recap, { leagueName: "F1 Underground", note: "Sacadón de Ana", author: "Tomas", noX2: ["VER", "RUS"] }, { name: "Ana", playerId: 1 });
    expect(mail.subject).toBe("R23 VEG recap: Ana wins with 306 · Gianluca and Paolo 18 points apart");
    expect(recapSubject(recap)).toBe(mail.subject);
    expect(mail.text).toContain("You scored 306 (1st of 8 this race).");
    expect(mail.text).toContain("Season: 7th, 496 points, 343 behind 1st.");
    expect(mail.text).toContain("Sacadón de Ana\n— Tomas");
    expect(mail.text).toContain("Can't be ×2 (20M or more): VER, RUS.");
    expect(mail.html).toContain("cid:season-graph@f1underground");
    expect(mail.html).toContain("Build my team");
  });

  it("renders all four share images as PNGs", async () => {
    for (const k of SHARE_KINDS) {
      const png = await shareImage(k, recap);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.length).toBeGreaterThan(10_000);
    }
  }, 60_000);
});
