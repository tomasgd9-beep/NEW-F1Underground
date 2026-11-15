// Creates (or resets) a local PGlite database with demo data, for trying the
// app without a Neon account:  npm run db:local  then  npm run dev:local
// Prints a session cookie for each demo user so you can skip sign-in.
import { rmSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";

const dir = "./.pglite";

async function main() {
  rmSync(dir, { recursive: true, force: true });
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });

  const [season] = await db.insert(schema.seasons).values({ year: 2027, status: "active" }).returning();
  const day = 864e5;
  const [r1, r2] = await db.insert(schema.races).values([
    { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australia", deadline: new Date(Date.now() - 7 * day), results: "final" },
    { seasonId: season.id, round: 2, label: "R02 CHN", name: "China", isSprint: true, deadline: new Date(Date.now() + 5 * day + 7 * 36e5) },
    { seasonId: season.id, round: 3, label: "R03 JPN", name: "Japan", deadline: new Date(Date.now() + 12 * day) },
  ]).returning();
  await seedGrid(db, r1.id, r2.id);

  const mk = async (email: string, name: string) =>
    (await db.insert(schema.users).values({ email, name }).returning())[0];
  const tomas = await mk("tomas@example.com", "Tomás");
  const ana = await mk("ana@example.com", "Ana");
  const newbie = await mk("new@example.com", "New Person");
  const guest = await mk("guest@example.com", "Guest");

  await db.insert(schema.players).values([
    { displayName: "Tomás", userId: tomas.id, role: "commissioner" },
    { displayName: "Ana", userId: ana.id },
    { displayName: "JB" },
    { displayName: "IV", claimRequestedBy: newbie.id },
  ]);
  await db.insert(schema.invites).values([
    { kind: "link", token: "demo-join-link", invitedByUserId: tomas.id },
    { kind: "email", token: "demo-email", email: "friend@example.com", invitedByUserId: ana.id },
  ]);
  await db.insert(schema.activityLog).values([{ actor: tomas.id, action: "player_added", detail: {} }]);

  const expires = new Date(Date.now() + 30 * day);
  for (const [who, u] of [["tomas", tomas], ["ana", ana], ["new", newbie], ["guest", guest]] as const) {
    const token = `demo-session-${who}`;
    await db.insert(schema.sessions).values({ sessionToken: token, userId: u.id, expires });
    console.log(`${who}: cookie authjs.session-token=${token}`);
  }
  console.log("Local database ready in", dir);
}

// Demo grid based on the 2026 sheet (prices are seed values, points are made up).
const TEAMS: [string, string, string, number][] = [
  ["MER", "Mercedes", "#27F4D2", 92.75], ["FER", "Ferrari", "#E8002D", 80.5], ["RED", "Red Bull Racing", "#3671C6", 34.28],
  ["VRB", "Racing Bulls", "#6692FF", 31.53], ["HAA", "Haas", "#B6BABD", 30.3], ["ALP", "Alpine", "#0093CC", 28.16],
  ["MCL", "McLaren", "#FF8000", 27.85], ["WIL", "Williams", "#64C4FF", 15.61], ["CAD", "Cadillac", "#AAAAAD", 8.26],
  ["AUD", "Audi", "#F50537", 7.04], ["AST", "Aston Martin", "#229971", 1.22],
];
const DRIVERS: [string, string, string, number][] = [
  ["ANT", "Andrea Kimi Antonelli", "MER", 45.91], ["RUS", "George Russell", "MER", 33.98],
  ["LEC", "Charles Leclerc", "FER", 33.98], ["HAM", "Lewis Hamilton", "FER", 28.16],
  ["PIA", "Oscar Piastri", "MCL", 13.16], ["NOR", "Lando Norris", "MCL", 13.77],
  ["VER", "Max Verstappen", "RED", 23.57], ["HAD", "Isack Hadjar", "RED", 7.35],
  ["LAW", "Liam Lawson", "VRB", 15.3], ["LIN", "Arvid Lindblad", "VRB", 7.04],
  ["GAS", "Pierre Gasly", "ALP", 13.77], ["COL", "Franco Colapinto", "ALP", 8.57],
  ["SAI", "Carlos Sainz", "WIL", 12.55], ["ALB", "Alexander Albon", "WIL", 2.45],
  ["CAM", "CAM (new Haas driver)", "HAA", 12.86], ["BEA", "Oliver Bearman", "HAA", 16.53],
  ["HUL", "Nico Hülkenberg", "AUD", 5.2], ["BOR", "Gabriel Bortoleto", "AUD", 4.9],
  ["PER", "Sergio Pérez", "CAD", 8.57], ["BOT", "Valtteri Bottas", "CAD", 1.53],
  ["ALO", "Fernando Alonso", "AST", 1.22], ["STR", "Lance Stroll", "AST", 1.22],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedGrid(db: any, r1: number, r2: number) {
  const wobble = (i: number) => Math.round(((i * 37) % 13) - 6) / 10; // −0.6 … +0.6
  const fake = (i: number) => ((i * 53) % 41) - 8; // −8 … 32
  const teams = await db.insert(schema.constructors).values(TEAMS.map(([ticker, name, colour]) => ({ ticker, name, colour }))).returning();
  const teamId = new Map(teams.map((t: { ticker: string; id: number }) => [t.ticker, t.id]));
  const ppl = await db.insert(schema.people).values(DRIVERS.map(([ticker, fullName]) => ({ ticker, fullName }))).returning();
  const st = await db.insert(schema.stints).values(
    DRIVERS.map(([, , team], i) => ({ personId: ppl[i].id, constructorId: teamId.get(team) })),
  ).returning();
  await db.insert(schema.assetPrices).values([
    ...DRIVERS.flatMap(([, , , price], i) => [
      { raceId: r1, personId: ppl[i].id, finalPrice: String(price) },
      { raceId: r2, personId: ppl[i].id, finalPrice: (price + wobble(i)).toFixed(2) },
    ]),
    ...TEAMS.flatMap(([t, , , price], i) => [
      { raceId: r1, constructorId: teamId.get(t), finalPrice: String(price) },
      { raceId: r2, constructorId: teamId.get(t), finalPrice: (price + wobble(i + 5)).toFixed(2) },
    ]),
  ]);
  await db.insert(schema.assetPoints).values([
    ...st.map((s: { id: number }, i: number) => ({ raceId: r1, stintId: s.id, total: String(fake(i)), isFinal: true })),
    ...TEAMS.map(([t], i) => ({ raceId: r1, constructorId: teamId.get(t), total: String(fake(i + 3) * 2), isFinal: true })),
  ]);
}

main().then(() => process.exit(0));
