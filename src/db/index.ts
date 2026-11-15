import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Any Drizzle Postgres database with our schema (Neon in the app, PGlite in tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

let _db: Db | undefined;

/**
 * The app's database. Created on first use so builds don't need DATABASE_URL.
 * `DATABASE_URL=pglite:./.pglite` runs against a local file database for
 * development without a Neon account (run `npm run db:local` first).
 */
export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see SETUP.md)");
    if (url.startsWith("pglite:")) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PGlite } = require("@electric-sql/pglite");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { drizzle: drizzlePglite } = require("drizzle-orm/pglite");
      _db = drizzlePglite(new PGlite(url.slice("pglite:".length)), { schema }) as Db;
    } else {
      _db = drizzle(neon(url), { schema }) as unknown as Db;
    }
  }
  return _db!;
}

export { schema };
