// Reading f1fantasytools. Their pages embed the data as escaped JSON; this is
// a port of the 2026 sheet's tested Apps Script (grab_, assetCols_,
// deadlineFor_, expectedPoints_).

export const FFT_LIVE = "https://f1fantasytools.com/live";
export const FFT_CALC = "https://f1fantasytools.com/team-calculator";

type Pts = { points?: number } | undefined;
type Session = Record<string, Pts>;
export type FftAsset = {
  id: string; // "RED_VER" or "RED"
  abbreviation: string; // "VER" or "RED"
  constructorId?: string; // drivers only
  type: "driver" | "constructor";
  isActive: boolean;
  color?: string;
  price?: number;
  raceResult?: { S?: Session; Q?: Session; R?: Session };
};
type SessionStatus = { started?: boolean; finished?: boolean; finalized?: boolean };
export type FftRace = {
  season?: number;
  id: string; // "2026_21"
  name: string;
  roundNumber: number;
  countryCode?: string;
  countryName?: string;
  city?: string;
  sprint: boolean;
  start_times?: Record<string, string | null>;
  status?: { sprint?: SessionStatus; qualifying?: SessionStatus; race?: SessionStatus };
  nextRace?: FftRace | null;
};
export type FftLive = { drivers: FftAsset[]; constructors: FftAsset[]; race: FftRace };

export class FftError extends Error {}

/** Find `"key":` in the unescaped page and parse the bracketed JSON after it. */
export function grab<T>(html: string, key: string, open: "[" | "{", close: "]" | "}"): T {
  const i = html.indexOf(`"${key}":`);
  if (i < 0) throw new FftError(`f1fantasytools: ${key} not found (site layout may have changed)`);
  const j = html.indexOf(open, i);
  let depth = 0;
  let k = j;
  for (; k < html.length; k++) {
    const c = html[k];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (!depth) break;
    }
  }
  return JSON.parse(html.slice(j, k + 1)) as T;
}

export const unescapePage = (raw: string) => raw.replace(/\\"/g, '"');

export function parseLive(raw: string): FftLive {
  const h = unescapePage(raw);
  return {
    drivers: grab<FftAsset[]>(h, "initialDrivers", "[", "]"),
    constructors: grab<FftAsset[]>(h, "initialConstructors", "[", "]"),
    race: grab<FftRace>(h, "initialRace", "{", "}"),
  };
}

async function getPage(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (F1 Underground league)", "Cache-Control": "no-cache" },
    cache: "no-store",
  });
  if (!res.ok) throw new FftError(`f1fantasytools returned HTTP ${res.status}`);
  return res.text();
}

export async function fetchLive(fetchImpl: typeof fetch = fetch): Promise<FftLive> {
  return parseLive(await getPage(FFT_LIVE, fetchImpl));
}

/** Expected points per ticker from the analyst simulation (first preset for the round). */
export function parseAnalystSims(raw: string, round: number): { name: string; xp: Record<string, number> } | null {
  const h = unescapePage(raw);
  type Sim = {
    name: string;
    raceweek: number;
    drivers: { pts: Record<string, number> };
    constructors?: { pts: Record<string, number> };
  };
  let sims: Sim[];
  try {
    sims = grab<Sim[]>(h, "analystSims", "[", "]");
  } catch {
    return null;
  }
  const s = sims.find((x) => x.raceweek === round);
  if (!s) return null;
  const xp: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.drivers.pts)) xp[k] = v; // keyed "RED_VER"
  for (const [k, v] of Object.entries(s.constructors?.pts ?? {})) xp[k] = v; // keyed "RED"
  return { name: s.name, xp };
}

export async function fetchExpectedPoints(round: number, fetchImpl: typeof fetch = fetch) {
  try {
    return parseAnalystSims(await getPage(FFT_CALC, fetchImpl), round);
  } catch {
    return null;
  }
}

const P = (o: Pts) => (o && typeof o.points === "number" ? o.points : 0);

export type Started = { S: boolean; Q: boolean; R: boolean };

export function sessionsStarted(race: FftRace): Started {
  const st = race.status ?? {};
  return { S: !!st.sprint?.started, Q: !!st.qualifying?.started, R: !!st.race?.started };
}

export type Breakdown = {
  S?: { pos: number; gained: number; overtakes: number; fastestLap: number; total: number };
  Q?: { pos: number; team: number; total: number };
  R?: { pos: number; gained: number; overtakes: number; fastestLap: number; dotdPit: number; total: number };
};

/** Session breakdown exactly as the sheet's Points tab splits it. Sessions not started are left out. */
export function breakdown(a: FftAsset, started: Started): { parts: Breakdown; total: number | null } {
  const r = a.raceResult ?? {};
  const parts: Breakdown = {};
  let total = 0;
  let any = false;
  if (started.S && r.S) {
    const s = r.S;
    const t = P(s.totalPoints), g = P(s.positionsGained), o = P(s.overtakes), fl = P(s.fastestLapPoints);
    parts.S = { pos: t - g - o - fl, gained: g, overtakes: o, fastestLap: fl, total: t };
    total += t;
    any = true;
  }
  if (started.Q && r.Q) {
    const q = r.Q;
    const t = P(q.totalPoints), tw = P(q.teamworkPoints);
    parts.Q = { pos: t - tw, team: a.type === "constructor" ? tw : 0, total: t };
    total += t;
    any = true;
  }
  if (started.R && r.R) {
    const x = r.R;
    const t = P(x.totalPoints);
    const pos = P(x.positionPoints) + P(x.notClassifiedPoints) + P(x.disqualifiedPoints);
    const g = P(x.positionsGained), o = P(x.overtakes), fl = P(x.fastestLapPoints);
    parts.R = { pos, gained: g, overtakes: o, fastestLap: fl, dotdPit: t - pos - g - o - fl, total: t };
    total += t;
    any = true;
  }
  return { parts, total: any ? total : null };
}

/** Start of the first points-scoring session: the Sprint on sprint weekends, else Qualifying. */
export function deadlineOf(race: FftRace): { when: Date; session: "Sprint" | "Qualifying" } | null {
  const st = race.start_times ?? {};
  let keys = Object.keys(st).filter((k) => st[k]);
  keys = race.sprint
    ? keys.filter((k) => !/qual/i.test(k) && !/^race$/i.test(k))
    : keys.filter((k) => /^qualifying$/i.test(k));
  if (!keys.length) return null;
  const when = keys.map((k) => new Date(st[k]!)).sort((a, b) => a.getTime() - b.getTime())[0];
  return { when, session: race.sprint ? "Sprint" : "Qualifying" };
}

export type ResultsState = "none" | "live" | "provisional" | "final";

export function resultsState(race: FftRace): ResultsState {
  const st = race.status ?? {};
  if (st.race?.finalized) return "final";
  if (st.race?.finished) return "provisional";
  if (st.sprint?.started || st.qualifying?.started || st.race?.started) return "live";
  return "none";
}

export const CONSTRUCTOR_NAMES: Record<string, string> = {
  ALP: "Alpine",
  AST: "Aston Martin",
  AUD: "Audi",
  CAD: "Cadillac",
  FER: "Ferrari",
  HAA: "Haas",
  MCL: "McLaren",
  MER: "Mercedes",
  RED: "Red Bull Racing",
  VRB: "Racing Bulls",
  WIL: "Williams",
};

/** Full names for the tickers we know; others show the ticker until a commissioner renames them. */
export const DRIVER_NAMES: Record<string, string> = {
  ALB: "Alexander Albon",
  ALO: "Fernando Alonso",
  ANT: "Andrea Kimi Antonelli",
  BEA: "Oliver Bearman",
  BOR: "Gabriel Bortoleto",
  BOT: "Valtteri Bottas",
  CAM: "Rafael Câmara",
  COL: "Franco Colapinto",
  GAS: "Pierre Gasly",
  HAD: "Isack Hadjar",
  HAM: "Lewis Hamilton",
  HIR: "Ryo Hirakawa",
  HUL: "Nico Hülkenberg",
  LAW: "Liam Lawson",
  LEC: "Charles Leclerc",
  LIN: "Arvid Lindblad",
  NOR: "Lando Norris",
  OCO: "Esteban Ocon",
  PER: "Sergio Pérez",
  PIA: "Oscar Piastri",
  RUS: "George Russell",
  SAI: "Carlos Sainz",
  STR: "Lance Stroll",
  TSU: "Yuki Tsunoda",
  VER: "Max Verstappen",
};

/** USA hosts several races, so those use the city, like the sheet's "R23 VEG". */
const CITY_CODES: Record<string, string> = { "Las Vegas": "VEG", Miami: "MIA", Austin: "USA" };

/** Short label like the sheet's "R22 BRA": round plus country code (city for US races). */
export function raceLabel(race: FftRace): string {
  const code =
    (race.city && CITY_CODES[race.city]) ||
    (race.countryCode && race.countryCode.slice(0, 3).toUpperCase()) ||
    race.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  return `R${String(race.roundNumber).padStart(2, "0")} ${code}`;
}
