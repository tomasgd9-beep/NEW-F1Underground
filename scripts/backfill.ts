// Runs before every build, after migrations: imports the seasons played on the old
// spreadsheets from the exports in ./data (once each; later builds see it's done and skip).
// Never blocks a deploy: a failure is printed and logged, and the build goes on.
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { backfill2026, backfillSeason } from "../src/lib/backfill";
import { logActivity } from "../src/lib/league";

const files = (year: number) => ({
  races: readFileSync(`data/${year}-races.txt`, "utf8"),
  points: readFileSync(`data/${year}-points.txt`, "utf8"),
  teams: readFileSync(`data/${year}-teams.txt`, "utf8"),
});

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    console.log("backfill: no DATABASE_URL, skipping");
    return;
  }
  const db = getDb();
  const runs: [number, () => ReturnType<typeof backfill2026>][] = [
    [2026, () => backfill2026(db, files(2026))],
    // Finished seasons: view-only. 2024 has no race-by-race driver prices.
    [2025, () => backfillSeason(db, 2025, files(2025), { prices: true, past: true })],
    [2024, () => backfillSeason(db, 2024, files(2024), { prices: false, past: true })],
  ];
  for (const [year, run] of runs) {
    try {
      const r = await run();
      console.log(r.skipped ? `backfill ${year}: already done` : `backfill ${year}: ${JSON.stringify(r)}`);
    } catch (e) {
      console.error(`backfill ${year} failed:`, e);
      await logActivity(db, "job", `backfill_${year}`, { error: String(e) }, { result: "error" }).catch(() => {});
    }
  }
}

main().then(() => process.exit(0));
