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
  await db.insert(schema.races).values([
    { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australia", deadline: new Date(Date.now() - 7 * day) },
    { seasonId: season.id, round: 2, label: "R02 CHN", name: "China", isSprint: true, deadline: new Date(Date.now() + 5 * day + 7 * 36e5) },
    { seasonId: season.id, round: 3, label: "R03 JPN", name: "Japan", deadline: new Date(Date.now() + 12 * day) },
  ]);

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

main().then(() => process.exit(0));
