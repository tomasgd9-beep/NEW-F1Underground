// League maths, pure (no database), used on the server and in the browser.

export type Slot = "x2" | "d" | "c";
export type TeamPick = { assetId: string; slot: Slot };
export type RaceTeam = { picks: TeamPick[]; penalty: number; origin: "manual" | "random" | "auto_filled" };

/** points[raceId][assetId] = that asset's total for the race (null = no points yet). */
export type PointsMap = Record<number, Record<string, number | null>>;

/** A team's score for one race: ×2 driver doubled, plus the (negative) budget penalty. */
export function teamScore(team: RaceTeam, pts: Record<string, number | null> | undefined): { total: number; x2: number } {
  let total = 0;
  let x2 = 0;
  for (const p of team.picks) {
    const v = pts?.[p.assetId] ?? 0;
    if (p.slot === "x2") {
      total += 2 * v;
      x2 = 2 * v;
    } else total += v;
  }
  return { total: total + team.penalty, x2 };
}

/** Ranks with ties sharing a place and the next place skipped (1, 1, 3). */
export function shareRanks<T>(rows: T[], equal: (a: T, b: T) => boolean): number[] {
  const ranks: number[] = [];
  rows.forEach((r, i) => {
    ranks.push(i > 0 && equal(rows[i - 1], r) ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

export type StandingRow = {
  playerId: number;
  total: number;
  rank: number;
  /** Points per race, aligned with `raceIds` (null = not playing that race). */
  perRace: (number | null)[];
  cumulative: number[];
  lastRace: number | null;
  move: number | null; // positive = moved up since the previous race
  gapAbove: number | null;
  gapLeader: number | null;
};

/**
 * Season standings over `raceIds` (oldest first, scored races only).
 * Ties: (1) whoever reached the total first, (2) more ×2 points in the latest
 * race, otherwise they share the place (1, 1, 3).
 */
export function standings(
  playerIds: number[],
  raceIds: number[],
  score: (playerId: number, raceId: number) => { total: number; x2: number } | null,
): StandingRow[] {
  const rankAfter = (upto: number) => {
    const ids = raceIds.slice(0, upto);
    const rows = playerIds.map((pid) => {
      const per = ids.map((rid) => score(pid, rid));
      const cum: number[] = [];
      per.reduce((s, v, i) => ((cum[i] = s + (v?.total ?? 0)), cum[i]), 0);
      const total = cum.at(-1) ?? 0;
      // Index of the race at which the player first reached their current total.
      const reachedAt = cum.findIndex((c) => c >= total);
      const lastX2 = per.at(-1)?.x2 ?? 0;
      return { pid, per, cum, total, reachedAt: reachedAt < 0 ? Infinity : reachedAt, lastX2 };
    });
    rows.sort((a, b) => b.total - a.total || a.reachedAt - b.reachedAt || b.lastX2 - a.lastX2);
    const ranks = shareRanks(
      rows,
      (a, b) => a.total === b.total && a.reachedAt === b.reachedAt && a.lastX2 === b.lastX2,
    );
    return rows.map((r, i) => ({ ...r, rank: ranks[i] }));
  };

  const now = rankAfter(raceIds.length);
  const before = raceIds.length > 1 ? rankAfter(raceIds.length - 1) : null;
  const prevRank = new Map(before?.map((r) => [r.pid, r.rank]));
  const leader = now[0]?.total ?? 0;
  return now.map((r, i) => ({
    playerId: r.pid,
    total: r.total,
    rank: r.rank,
    perRace: r.per.map((v) => (v ? v.total : null)),
    cumulative: r.cum,
    lastRace: r.per.at(-1)?.total ?? null,
    move: prevRank.has(r.pid) ? prevRank.get(r.pid)! - r.rank : null,
    gapAbove: i === 0 ? null : now[i - 1].total - r.total,
    gapLeader: i === 0 ? null : leader - r.total,
  }));
}

/** Rank of every player after each race (for the graph). */
export function rankHistory(
  playerIds: number[],
  raceIds: number[],
  score: (playerId: number, raceId: number) => { total: number; x2: number } | null,
): Record<number, number[]> {
  const out: Record<number, number[]> = Object.fromEntries(playerIds.map((p) => [p, []]));
  for (let i = 1; i <= raceIds.length; i++) {
    for (const r of standings(playerIds, raceIds.slice(0, i), score)) out[r.playerId].push(r.rank);
  }
  return out;
}

/** Green (best) to red (worst) for a value within one race's range. */
export function heat(value: number, min: number, max: number): string {
  if (max === min) return "hsl(120 45% 45% / 0.18)";
  const t = (value - min) / (max - min); // 0 worst … 1 best
  return `hsl(${Math.round(t * 120)} 60% 45% / 0.22)`;
}
