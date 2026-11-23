// A small league shaped like Las Vegas 2026, for recap and share-image tests.
import type { LeagueData } from "@/lib/league-data";

const drivers: [string, string, string][] = [
  ["PIA", "McLaren", "#ff8000"], ["NOR", "McLaren", "#ff8000"], ["RUS", "Mercedes", "#27f4d2"], ["ANT", "Mercedes", "#27f4d2"],
  ["SAI", "Williams", "#1868db"], ["ALB", "Williams", "#1868db"], ["GAS", "Alpine", "#ff87bc"], ["COL", "Alpine", "#ff87bc"],
  ["BEA", "Haas", "#9c9fa2"], ["HAD", "Red Bull", "#3671c6"], ["PER", "Cadillac", "#7a7a7a"], ["LEC", "Ferrari", "#e8002d"],
];
const teamsC: [string, string][] = [["MCL", "#ff8000"], ["MER", "#27f4d2"], ["ALP", "#ff87bc"], ["VRB", "#6692ff"]];

export function vegasLike(): LeagueData {
  const assets: LeagueData["assets"] = {};
  drivers.forEach(([t, team, colour], i) => {
    assets[`s${i + 1}`] = { id: `s${i + 1}`, kind: "driver", ticker: t, name: t, team, colour, statKey: `p${i + 1}` };
  });
  teamsC.forEach(([t, colour], i) => {
    assets[`c${i + 1}`] = { id: `c${i + 1}`, kind: "constructor", ticker: t, name: t, team: t, colour, statKey: `c${i + 1}` };
  });
  const id = (t: string) => Object.values(assets).find((a) => a.ticker === t)!.id;
  const names = ["Ana", "Paolo", "Joaquin", "Marcelo", "Gianluca", "Tomas", "Alonso", "Gioacchino"];
  const players = names.map((name, i) => ({ id: i + 1, name, joinedRaceId: null }));
  const races = [1, 2, 3].map((r) => ({
    id: r,
    label: ["R21 MEX", "R22 BRA", "R23 VEG"][r - 1],
    name: ["Mexico City Grand Prix", "São Paulo Grand Prix", "Las Vegas Grand Prix"][r - 1],
    results: "final" as const,
    locked: true,
    deadline: "2026-11-20T04:00:00Z",
    isSprint: false,
  }));
  races.push({ id: 4, label: "R24 QAT", name: "Qatar Grand Prix", results: "none" as never, locked: false, deadline: "2026-11-28T13:30:00Z", isSprint: true });
  const pts: Record<string, number> = {
    PIA: 57, NOR: 46, RUS: 23, ANT: 43, SAI: 27, ALB: -20, GAS: 26, COL: 22, BEA: 20, HAD: 9, PER: -17, LEC: 13,
    MCL: 113, MER: 78, ALP: 58, VRB: 19,
  };
  const team = (x2: string, ds: string[], c: string, origin: "manual" | "random" = "manual", penalty = 0) => ({
    picks: [{ assetId: id(x2), slot: "x2" as const }, ...ds.map((d) => ({ assetId: id(d), slot: "d" as const })), { assetId: id(c), slot: "c" as const }],
    penalty,
    origin,
  });
  const vegas = {
    1: team("PIA", ["ANT", "SAI", "GAS", "PER"], "MCL"),
    2: team("PIA", ["NOR", "SAI", "GAS", "ALB"], "MER"),
    3: team("RUS", ["PIA", "NOR", "ANT", "HAD"], "ALP"),
    4: team("RUS", ["PIA", "SAI", "COL", "BEA"], "MER", "random"),
    5: team("RUS", ["PIA", "GAS", "COL", "BEA"], "MER", "random"),
    6: team("RUS", ["PIA", "GAS", "BEA", "ALB"], "MER"),
    7: team("RUS", ["SAI", "GAS", "BEA", "HAD"], "MER", "random", -10),
    8: team("RUS", ["GAS", "COL", "HAD", "ALB"], "MER"),
  };
  // Earlier races: flat teams with fixed totals via adjust.
  const flat = (adjust: number) => ({ picks: [], penalty: 0, origin: "manual" as const, adjust });
  const r1 = [100, 120, 300, 80, 150, 200, 260, 330];
  const r2 = [90, 150, 280, 100, 160, 260, 240, 300];
  return {
    season: { id: 1, year: 2026 },
    seasons: [{ id: 1, year: 2026 }],
    races,
    players,
    meId: 6,
    teams: {
      1: Object.fromEntries(players.map((p, i) => [p.id, flat(r1[i])])),
      2: Object.fromEntries(players.map((p, i) => [p.id, flat(r2[i])])),
      3: vegas,
    },
    submitted: {},
    points: { 1: {}, 2: {}, 3: Object.fromEntries(Object.entries(pts).map(([t, v]) => [id(t), v])) },
    parts: {},
    assets,
    stats: {},
  };
}
