import { describe, expect, it } from "vitest";
import { shareRanks, standings, teamScore, type RaceTeam } from "@/lib/standings";

describe("team score", () => {
  it("doubles the ×2 driver and adds the penalty", () => {
    const team: RaceTeam = {
      picks: [
        { assetId: "s1", slot: "x2" },
        { assetId: "s2", slot: "d" },
        { assetId: "c1", slot: "c" },
      ],
      penalty: -10,
      origin: "manual",
    };
    expect(teamScore(team, { s1: 65, s2: -3, c1: 20 })).toEqual({ total: 130 - 3 + 20 - 10, x2: 130 });
    expect(teamScore(team, {})).toEqual({ total: -10, x2: 0 });
  });
});

describe("shared ranks", () => {
  it("skips the next place after a tie", () => {
    expect(shareRanks([10, 10, 8, 7, 7, 7, 1], (a, b) => a === b)).toEqual([1, 1, 3, 4, 4, 4, 7]);
  });
});

describe("season standings", () => {
  // score[player][raceIndex] = [total, x2]
  const make = (data: Record<number, [number, number][]>) => {
    const races = data[Object.keys(data).map(Number)[0]].map((_, i) => i + 1);
    return {
      races,
      score: (pid: number, rid: number) => {
        const v = data[pid][rid - 1];
        return v ? { total: v[0], x2: v[1] } : null;
      },
    };
  };

  it("orders by total, with gaps and movement", () => {
    const { races, score } = make({ 1: [[10, 0], [50, 0]], 2: [[40, 0], [5, 0]], 3: [[20, 0], [20, 0]] });
    const s = standings([1, 2, 3], races, score);
    expect(s.map((r) => [r.playerId, r.total, r.rank])).toEqual([[1, 60, 1], [2, 45, 2], [3, 40, 3]]);
    expect(s[1]).toMatchObject({ gapAbove: 15, gapLeader: 15, lastRace: 5 });
    expect(s.find((r) => r.playerId === 1)?.move).toBe(2); // 3rd → 1st
    expect(s.find((r) => r.playerId === 2)?.move).toBe(-1);
  });

  it("tie-break 1: whoever reached the total first", () => {
    // Both on 50; player 2 had 50 after race 1, player 1 only after race 2.
    const { races, score } = make({ 1: [[20, 0], [30, 0]], 2: [[50, 0], [0, 0]] });
    expect(standings([1, 2], races, score).map((r) => [r.playerId, r.rank])).toEqual([[2, 1], [1, 2]]);
  });

  it("tie-break 2: more ×2 points in the latest race", () => {
    const { races, score } = make({ 1: [[10, 0], [40, 10]], 2: [[10, 0], [40, 30]] });
    expect(standings([1, 2], races, score).map((r) => [r.playerId, r.rank])).toEqual([[2, 1], [1, 2]]);
  });

  it("otherwise they share the place: 1, 1, 3", () => {
    const { races, score } = make({ 1: [[30, 10]], 2: [[30, 10]], 3: [[5, 0]] });
    expect(standings([1, 2, 3], races, score).map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("players who missed races count 0 there", () => {
    const { races, score } = make({ 1: [[10, 0], [10, 0]], 2: [[0, 0], [15, 0]] });
    const s = standings([1, 2], races, (p, r) => (p === 2 && r === 1 ? null : score(p, r)));
    expect(s.find((r) => r.playerId === 2)?.perRace).toEqual([null, 15]);
  });
});
