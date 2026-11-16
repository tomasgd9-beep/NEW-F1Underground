// Runs before every build, after migrations: imports the 2026 season from the
// spreadsheet export in ./data (once; later builds see it's done and skip).
// Never blocks a deploy: a failure is printed and logged, and the build goes on.
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { backfill2026 } from "../src/lib/backfill";
import { logActivity } from "../src/lib/league";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    console.log("backfill: no DATABASE_URL, skipping");
    return;
  }
  const db = getDb();
  try {
    const r = await backfill2026(db, {
      races: readFileSync("data/2026-races.txt", "utf8"),
      points: readFileSync("data/2026-points.txt", "utf8"),
      teams: readFileSync("data/2026-teams.txt", "utf8"),
    });
    console.log(r.skipped ? "backfill: already done" : `backfill: ${JSON.stringify(r)}`);
  } catch (e) {
    console.error("backfill failed:", e);
    await logActivity(db, "job", "backfill_2026", { error: String(e) }, { result: "error" }).catch(() => {});
  }
}

main().then(() => process.exit(0));
