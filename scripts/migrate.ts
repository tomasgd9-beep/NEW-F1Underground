// Runs before every build: brings the Neon database up to date with the
// migrations in ./drizzle. Skipped when there's no real database (CI, local demo).
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    console.log("migrate: no DATABASE_URL, skipping");
    return;
  }
  await migrate(drizzle(neon(url)), { migrationsFolder: "drizzle" });
  console.log("migrate: database is up to date");
}

main().catch((e) => {
  console.error("migrate failed:", e);
  process.exit(1);
});
