// Creates (or resets) a local PGlite database with demo data, for trying the
// app without a Neon account:  npm run db:local  then  npm run dev:local
// A mid-season league: 3 locked races with teams and points, 1 open race.
// Prices and points are made up.
import { rmSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";

const dir = "./.pglite";

const TEAMS: [string, string, string, number][] = [
  ["MER", "Mercedes", "#27F4D2", 55.4], ["FER", "Ferrari", "#E8002D", 66.12], ["RED", "Red Bull Racing", "#3671C6", 68.26],
  ["VRB", "Racing Bulls", "#6692FF", 30], ["HAA", "Haas", "#B6BABD", 2.45], ["ALP", "Alpine", "#0093CC", 4.59],
  ["MCL", "McLaren", "#FF8000", 46.83], ["WIL", "Williams", "#64C4FF", 15.3], ["CAD", "Cadillac", "#AAAAAD", 2.45],
  ["AUD", "Audi", "#F50537", 25.71], ["AST", "Aston Martin", "#229971", 2.45],
];
const DRIVERS: [string, string, string, number][] = [
  ["VER", "Max Verstappen", "RED", 43.16], ["LEC", "Charles Leclerc", "FER", 30.3], ["HAM", "Lewis Hamilton", "FER", 26.63],
  ["ANT", "Andrea Kimi Antonelli", "MER", 26.32], ["NOR", "Lando Norris", "MCL", 22.04], ["HAD", "Isack Hadjar", "RED", 17.45],
  ["RUS", "George Russell", "MER", 16.22], ["LAW", "Liam Lawson", "VRB", 13.16], ["PIA", "Oscar Piastri", "MCL", 11.94],
  ["BOR", "Gabriel Bortoleto", "AUD", 11.02], ["PER", "Sergio Pérez", "CAD", 7.04], ["ALB", "Alexander Albon", "WIL", 4.9],
  ["LIN", "Arvid Lindblad", "VRB", 4.59], ["HUL", "Nico Hülkenberg", "AUD", 3.98], ["GAS", "Pierre Gasly", "ALP", 3.06],
  ["SAI", "Carlos Sainz", "WIL", 2.45], ["CAM", "CAM", "HAA", 2.45], ["COL", "Franco Colapinto", "ALP", 2.45],
  ["ALO", "Fernando Alonso", "AST", 2.45], ["STR", "Lance Stroll", "AST", 2.45], ["BEA", "Oliver Bearman", "HAA", 2.45],
  ["BOT", "Valtteri Bottas", "CAD", 2.45],
];
const PLAYERS = ["Tomas", "Ana", "Alonso", "Gianluca", "Gioacchino", "Joaquin", "Mikael", "Paolo", "Salvatore", "Marcelo", "Franco"];

/** Deterministic pseudo-random numbers so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

async function main() {
  rmSync(dir, { recursive: true, force: true });
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  const day = 864e5;
  const now = Date.now();
  const r = rng(7);

  const [season] = await db.insert(schema.seasons).values({ year: 2027, status: "active" }).returning();
  const done = { results: "final" as const, status: "completed" as const };
  const raceRows = await db
    .insert(schema.races)
    .values([
      { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australian Grand Prix", deadline: new Date(now - 21 * day), lockedAt: new Date(now - 21 * day), ...done },
      { seasonId: season.id, round: 2, label: "R02 CHN", name: "Chinese Grand Prix", isSprint: true, deadline: new Date(now - 14 * day), lockedAt: new Date(now - 14 * day), ...done },
      { seasonId: season.id, round: 3, label: "R03 JPN", name: "Japanese Grand Prix", deadline: new Date(now - 7 * day), lockedAt: new Date(now - 7 * day), ...done },
      { seasonId: season.id, round: 4, label: "R04 BHR", name: "Bahrain Grand Prix", deadline: new Date(now + 5 * day + 7 * 36e5) },
    ])
    .returning();

  const teams = await db
    .insert(schema.constructors)
    .values(TEAMS.map(([ticker, name, colour]) => ({ ticker, name, colour, fftId: ticker })))
    .returning();
  const teamId = new Map(teams.map((t) => [t.ticker, t.id]));
  const ppl = await db.insert(schema.people).values(DRIVERS.map(([ticker, fullName]) => ({ ticker, fullName }))).returning();
  const st = await db
    .insert(schema.stints)
    .values(DRIVERS.map(([t, , team], i) => ({ personId: ppl[i].id, constructorId: teamId.get(team)!, fftId: `${team}_${t}` })))
    .returning();

  // Prices for every race (small moves), points for the three scored races.
  const price = new Map<string, number>();
  for (const race of raceRows) {
    const rows = [
      ...DRIVERS.map(([, , , p], i) => ({ raceId: race.id, personId: ppl[i].id, finalPrice: (p + (r() - 0.5) * (race.round - 1)).toFixed(2) })),
      ...TEAMS.map(([t, , , p]) => ({ raceId: race.id, constructorId: teamId.get(t)!, finalPrice: (p + (r() - 0.5) * (race.round - 1)).toFixed(2) })),
    ];
    for (const x of rows) price.set(`${race.id}:${"personId" in x ? "p" + x.personId : "c" + x.constructorId}`, Number(x.finalPrice));
    await db.insert(schema.assetPrices).values(rows);
  }
  for (const race of raceRows.slice(0, 3)) {
    const sprint = race.round === 2;
    await db.insert(schema.assetPoints).values([
      ...st.map((s, i) => {
        const k = DRIVERS[i][3] / 45;
        const q = Math.round(r() * 10 * k);
        const rr = Math.round(r() * 45 * k - 6 + r() * 10);
        const sp = sprint ? Math.round(r() * 8 * k) : 0;
        const pos = Math.max(0, rr - 4);
        const ov = Math.min(Math.max(rr, 0), 2);
        return {
          raceId: race.id, stintId: s.id, total: String(q + rr + sp), qualiTotal: String(q), raceTotal: String(rr),
          sprintTotal: sprint ? String(sp) : null, isFinal: true,
          breakdown: {
            ...(sprint ? { S: { pos: sp, gained: 0, overtakes: 0, fastestLap: 0, total: sp } } : {}),
            Q: { pos: q, team: 0, total: q },
            R: { pos, gained: 2, overtakes: ov, fastestLap: 0, dotdPit: rr - pos - 2 - ov, total: rr },
          },
        };
      }),
      ...TEAMS.map(([t, , , p]) => {
        const v = Math.round(r() * 60 * (p / 70) - 5);
        return {
          raceId: race.id, constructorId: teamId.get(t)!, total: String(v), raceTotal: String(v), isFinal: true,
          breakdown: { R: { pos: v - 5, gained: 0, overtakes: 0, fastestLap: 0, dotdPit: 5, total: v } },
        };
      }),
    ]);
  }

  // Users who can sign in to the demo.
  const mk = async (email: string, name: string) => (await db.insert(schema.users).values({ email, name }).returning())[0];
  const tomas = await mk("tomas@example.com", "Tomas Garcia");
  const ana = await mk("ana@example.com", "Ana Krstanovic");
  const guest = await mk("guest@example.com", "Guest");

  const [league] = await db.update(schema.leagues).set({ code: "DEMO42" }).returning();
  const leagueId = league.id;
  const players = await db
    .insert(schema.players)
    .values(
      PLAYERS.map((displayName) => ({
        leagueId,
        displayName,
        userId: displayName === "Tomas" ? tomas.id : displayName === "Ana" ? ana.id : null,
        role: displayName === "Tomas" ? ("commissioner" as const) : ("player" as const),
      })),
    )
    .returning();

  // Teams for every player in the locked races; most have saved for the open one.
  const cheap = st.filter((_, i) => DRIVERS[i][3] < 20);
  const pick = <T,>(arr: T[], k: number) => [...arr].sort(() => r() - 0.5).slice(0, k);
  for (const race of raceRows) {
    const open = race.round === 4;
    for (const [pi, p] of players.entries()) {
      if (open && pi % 3 === 2) continue;
      // Realistic teams: try until one fits the budget (a couple end up slightly over).
      const limit = pi === 7 ? 101.5 : 100;
      let x2 = cheap[0], ds = st.slice(0, 4), c = teams[0], cost = Infinity;
      for (let tries = 0; tries < 500 && cost > limit; tries++) {
        x2 = pick(cheap, 1)[0];
        ds = pick(st.filter((s) => s.id !== x2.id), 4);
        c = pick(teams, 1)[0];
        cost = [x2, ...ds].reduce((s, d) => s + (price.get(`${race.id}:p${d.personId}`) ?? 0), 0) + (price.get(`${race.id}:c${c.id}`) ?? 0);
      }
      const over = cost - 100;
      const origin = !open && pi === 9 && race.round === 2 ? "random" : !open && pi === 4 && race.round === 3 ? "auto_filled" : "manual";
      await db.insert(schema.picks).values({
        playerId: p.id,
        raceId: race.id,
        doubleStintId: x2.id,
        driver1StintId: ds[0].id,
        driver2StintId: ds[1].id,
        driver3StintId: ds[2].id,
        driver4StintId: ds[3].id,
        constructorId: c.id,
        frozenTeamPrice: open ? null : cost.toFixed(2),
        penalty: open ? null : over > 0 ? -10 * Math.ceil(over) : 0,
        origin: origin as "manual" | "random" | "auto_filled",
      });
    }
  }

  await db.insert(schema.activityLog).values([{ leagueId, actor: tomas.id, action: "bootstrap_commissioner", detail: {} }]);
  const expires = new Date(now + 30 * day);
  for (const [who, u] of [["tomas", tomas], ["ana", ana], ["guest", guest]] as const) {
    await db.insert(schema.sessions).values({ sessionToken: `demo-session-${who}`, userId: u.id, expires });
  }
  console.log("League code: DEMO42");
  console.log("Local database ready in", dir);
}

main().then(() => process.exit(0));
