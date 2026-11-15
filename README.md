# F1 Underground

The F1 Underground fantasy league, moving from a Google Sheet to a website
for the 2027 season. The full plan is the "F1 Underground — Web App Plan"
doc; first-time setup is in [SETUP.md](SETUP.md).

Stack: Next.js on Vercel · Neon Postgres + Drizzle · Auth.js (Google or
emailed link) · a scheduled GitHub Actions job (from phase 3).

## Phases

1. **Foundation** (done): schema for the whole data model, sign-in, join
   link and email invites, claiming a 2026 profile, commissioner role,
   Admin → Players / Invites / Activity.
2. **My team** (done): team builder with saved picks, deadline enforced on
   the server, live over-budget penalty, Season / Last 3 / price moves.
3. **Scheduled job + Points** (done): f1fantasytools sync every 15 minutes,
   lock with auto-fill and random teams, next-race pricing, Points page,
   Admin race control and price import.
4. League + Admin race control.
5. History import, past seasons (season chip on League), replay test
   against the sheet.
6. Reminder and post-race emails.
7. Soft launch alongside the sheet.

## Layout

- `src/db/schema.ts`: every table; `drizzle/`: generated SQL migrations
  (`npm run db:generate` after changing the schema).
- `src/lib/league.ts`: membership rules (invites, joining, roles), each
  function taking the database so tests run it on PGlite.
- `src/app/(app)/`: pages behind sign-in, sharing the slim top bar.
- `src/app/actions.ts`: server actions that wrap the league rules.
- `tests/`: Vitest against an in-memory Postgres.
