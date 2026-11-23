// The weekend recap, worked out from the League data: the race table, the season
// table, the highlights and the graph series. Pure (no database), so the share
// images, the recap email and the tests all use the same numbers.
import type { LeagueData, LeagueRace } from "@/lib/league-data";
import { orderPicks, shareRanks, standings, teamScore, type StandingRow } from "@/lib/standings";

export type RecapChip = { assetId: string; ticker: string; colour: string; slot: "x2" | "d" | "c"; v: number };
export type RecapRaceRow = {
  rank: number;
  playerId: number;
  name: string;
  total: number;
  origin: "manual" | "random" | "auto_filled";
  penalty: number;
  chips: RecapChip[];
};
export type RecapSeasonRow = StandingRow & { name: string };
export type Highlight = { key: string; label: string; text: string; detail?: string };

export type Recap = {
  race: LeagueRace;
  /** Every scored race up to this one, oldest first (the season so far). */
  races: LeagueRace[];
  raceRows: RecapRaceRow[];
  season: RecapSeasonRow[];
  podium: RecapRaceRow[];
  highlights: Highlight[];
  /** The race open for picks after this one, if it's already set up. */
  next: LeagueRace | null;
  /** Gap to the leader after each race, per player (the leader's line is 0). */
  graph: { labels: string[]; leaderId: number | null; series: { playerId: number; name: string; values: number[] }[] };
};

const fmt = (v: number) => (v < 0 ? "−" : "") + (Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1));
const list = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function buildRecap(data: LeagueData, raceId: number): Recap | null {
  const race = data.races.find((r) => r.id === raceId);
  if (!race || !race.locked) return null;
  const name = (id: number) => data.players.find((p) => p.id === id)?.name ?? "?";
  const scored = data.races.filter((r) => r.locked && r.results !== "none");
  const upto = scored.filter((r) => data.races.indexOf(r) <= data.races.indexOf(race));
  const score = (pid: number, rid: number) => {
    const t = data.teams[rid]?.[pid];
    return t ? teamScore(t, data.points[rid]) : null;
  };
  const playerIds = data.players.map((p) => p.id);

  /* Race table */
  const pts = data.points[race.id] ?? {};
  const rows = playerIds
    .filter((pid) => data.teams[race.id]?.[pid])
    .map((pid) => {
      const team = data.teams[race.id][pid];
      return {
        playerId: pid,
        name: name(pid),
        total: teamScore(team, pts).total,
        origin: team.origin,
        penalty: team.penalty,
        chips: orderPicks(team.picks, pts).map((p) => {
          const a = data.assets[p.assetId];
          return { assetId: p.assetId, ticker: a?.ticker ?? "?", colour: a?.colour ?? "#888888", slot: p.slot, v: p.v };
        }),
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const ranks = shareRanks(rows, (a, b) => a.total === b.total);
  const raceRows: RecapRaceRow[] = rows.map((r, i) => ({ ...r, rank: ranks[i] }));
  const podium = raceRows.filter((r) => r.rank <= 3);

  /* Season table (from the first race of the season, like the League page's default) */
  const raceIds = upto.map((r) => r.id);
  const season = standings(playerIds, raceIds, score).map((s) => ({ ...s, name: name(s.playerId) }));

  /* Highlights */
  const highlights: Highlight[] = [];
  const allChips = raceRows.flatMap((r) => r.chips.map((c) => ({ ...c, player: r.name })));
  const holdersOf = (assetId: string, slot?: string) =>
    allChips.filter((c) => c.assetId === assetId && (!slot || c.slot === slot)).map((c) => c.player);
  const chipLabel = (c: RecapChip) => `${c.ticker}${c.slot === "x2" ? " ×2" : ""} · ${fmt(c.v)}`;

  if (allChips.length) {
    const best = allChips.reduce((a, b) => (b.v > a.v ? b : a));
    highlights.push({
      key: "pick",
      label: "Pick of the weekend",
      text: chipLabel(best),
      detail: list(holdersOf(best.assetId, best.slot)),
    });

    // Picked by exactly one player, best of those.
    const solo = allChips.filter((c) => holdersOf(c.assetId).length === 1 && c.v > 0);
    if (solo.length) {
      const top = solo.reduce((a, b) => (b.v > a.v ? b : a));
      highlights.push({ key: "solo", label: "Pick no one else had", text: chipLabel(top), detail: `only ${top.player}` });
    }

    const worst = allChips.reduce((a, b) => (b.v < a.v ? b : a));
    if (worst.v < best.v) {
      highlights.push({
        key: "flop",
        label: "Flop of the weekend",
        text: chipLabel(worst),
        detail: list(holdersOf(worst.assetId, worst.slot)),
      });
    }
  }

  const up = Math.max(0, ...season.map((s) => s.move ?? 0));
  if (up > 0) {
    const movers = season.filter((s) => s.move === up);
    highlights.push({
      key: "mover",
      label: movers.length > 1 ? "Biggest movers" : "Biggest mover",
      text: movers.map((m) => `${m.name} up ${up} to P${m.rank}`).join(" · "),
    });
  }

  // Closest fight: the two neighbours in the season table with the smallest gap.
  let fight: [RecapSeasonRow, RecapSeasonRow] | null = null;
  for (let i = 1; i < season.length; i++) {
    const g = season[i].gapAbove ?? Infinity;
    if (!fight || g < (fight[1].gapAbove ?? Infinity)) fight = [season[i - 1], season[i]];
  }
  if (fight && upto.length > 1) {
    const [a, b] = fight;
    highlights.push({
      key: "fight",
      label: "Closest fight",
      text: `${a.name} ${fmt(a.total)} vs ${b.name} ${fmt(b.total)}`,
      detail: `P${a.rank} and P${b.rank}, ${fmt(b.gapAbove ?? 0)} point${b.gapAbove === 1 ? "" : "s"} apart`,
    });
  }

  /* Next race */
  const after = data.races.slice(data.races.indexOf(race) + 1);
  const next = after.find((r) => !r.locked) ?? null;

  /* Graph: gap to the current leader after each race */
  const leaderId = season[0]?.playerId ?? null;
  const leaderCum = season.find((s) => s.playerId === leaderId)?.cumulative ?? [];
  const graph = {
    labels: upto.map((r) => r.label),
    leaderId,
    series: season.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      values: s.cumulative.map((v, i) => v - (leaderCum[i] ?? 0)),
    })),
  };

  return { race, races: upto, raceRows, season, podium, highlights, next, graph };
}

/** "Fri, Nov 27, 11:00 PM Toronto · 11:00 PM Lima" (one time when both cities agree). */
export function lockTime(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" });
  const t = (tz: string) => d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const tor = t("America/Toronto");
  const lim = t("America/Lima");
  return tor === lim ? `${day}, ${tor} Toronto / Lima` : `${day}, ${tor} Toronto · ${lim} Lima`;
}
