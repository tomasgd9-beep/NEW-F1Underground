// Admin → Corrections: change a race's deadline or status, correct points, fix a locked team.
// Choosing a race / driver / player is a plain link (?race=…), so the forms below come
// pre-filled with what's saved now.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPoints, assetPrices, people, players, pricePeers, races, seasons } from "@/db/schema";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { utcToTorontoInput } from "@/lib/corrections";
import { SLOTS, type Slot } from "@/lib/lineup";
import { myPicks, rowToPicks, teamAssets } from "@/lib/team";
import * as act from "@/app/actions";

const SLOT_LABEL: Record<Slot, string> = { double: "D1 ×2", d1: "D2", d2: "D3", d3: "D4", d4: "D5", team: "C" };
const field = "rounded border border-line bg-card px-1.5 py-1 text-sm";
const sub = "mt-4 border-t border-line pt-3 first:mt-0 first:border-0 first:pt-0";

export async function Corrections({
  db,
  leagueId,
  params,
  defaultRaceId,
}: {
  db: Db;
  leagueId: number;
  params: { race?: string; asset?: string; player?: string };
  defaultRaceId: number | null;
}) {
  const [season] = await db.select().from(seasons).orderBy(desc(seasons.year)).limit(1);
  if (!season) return <p className="text-sm text-muted">No season yet.</p>;
  const list = await db.select().from(races).where(eq(races.seasonId, season.id)).orderBy(desc(races.round));
  const race = list.find((r) => String(r.id) === params.race) ?? list.find((r) => r.id === defaultRaceId) ?? list[0];
  if (!race) return <p className="text-sm text-muted">No races yet.</p>;

  const assets = await teamAssets(db, race);
  const pts = await db.select().from(assetPoints).where(eq(assetPoints.raceId, race.id));
  const ptsOf = (id: string) =>
    pts.find((p) => (id.startsWith("s") ? `s${p.stintId}` : `c${p.constructorId}`) === id);
  const asset = assets.find((a) => a.id === params.asset);
  const row = asset ? ptsOf(asset.id) : undefined;
  const roster = await db
    .select({ id: players.id, name: players.displayName })
    .from(players)
    .where(and(eq(players.leagueId, leagueId), eq(players.active, true)))
    .orderBy(players.displayName);
  const player = roster.find((p) => String(p.id) === params.player);
  const team = player ? rowToPicks(await myPicks(db, player.id, race.id)) : null;
  const drivers = assets.filter((a) => a.kind === "driver").sort((a, b) => a.ticker.localeCompare(b.ticker));
  const cons = assets.filter((a) => a.kind === "constructor").sort((a, b) => a.ticker.localeCompare(b.ticker));
  const manual = pts.filter((p) => p.manual);
  const overrides = await db
    .select({ personId: assetPrices.personId, constructorId: assetPrices.constructorId, price: assetPrices.finalPrice })
    .from(assetPrices)
    .where(and(eq(assetPrices.raceId, race.id), sql`${assetPrices.overridePrice} is not null`));
  const overridden = overrides
    .map((o) => assets.find((a) => (o.personId ? a.personId === o.personId : a.id === `c${o.constructorId}`)))
    .filter((a) => a != null);
  const peerRows = await db
    .select({ personId: pricePeers.personId, peerPersonId: pricePeers.peerPersonId })
    .from(pricePeers)
    .where(eq(pricePeers.seasonId, season.id));
  const tickers = new Map((await db.select({ id: people.id, ticker: people.ticker }).from(people)).map((p) => [p.id, p.ticker]));
  const people4 = drivers.filter((d) => d.personId != null);
  const q = (extra: Record<string, string | number>) =>
    "/admin?" + new URLSearchParams({ race: String(race.id), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) }) + "#corrections";

  return (
    <div className="text-sm">
      {/* Which race */}
      <form action="/admin#corrections" className="flex flex-wrap items-center gap-2">
        <label className="text-muted" htmlFor="corr-race">
          Race
        </label>
        <select id="corr-race" name="race" defaultValue={race.id} className={field}>
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} · {r.name}
              {r.status !== "scheduled" && r.status !== "completed" ? ` (${r.status})` : ""}
            </option>
          ))}
        </select>
        <button className="rounded border border-line px-2 py-1 text-xs font-semibold">Open</button>
      </form>

      {/* 1. Deadline and status */}
      <div className={sub + " mt-3"}>
        <h3 className="mb-1 font-semibold">Deadline and status</h3>
        <ActionForm action={act.updateRaceAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="raceId" value={race.id} />
          <input type="hidden" name="was" value={race.deadline ? utcToTorontoInput(race.deadline) : ""} />
          <label className="grid gap-0.5">
            <span className="text-xs text-muted">Status</span>
            <select name="status" defaultValue={race.status === "completed" ? "scheduled" : race.status} className={field}>
              <option value="scheduled">On schedule</option>
              <option value="delayed">Delayed</option>
              <option value="relocated">Relocated</option>
              <option value="cancelled">Cancelled (skip it)</option>
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="text-xs text-muted">Deadline (Toronto time)</span>
            <input
              type="datetime-local"
              name="deadline"
              defaultValue={race.deadline ? utcToTorontoInput(race.deadline) : ""}
              disabled={!!race.lockedAt}
              className={field}
            />
          </label>
          <label className="flex items-center gap-1 pb-1.5 text-xs">
            <input type="checkbox" name="auto" defaultChecked={!race.deadlineManual} /> follow f1fantasytools
          </label>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
        <p className="mt-1 text-xs text-muted">
          Change the time to set the deadline yourself; the job then leaves it alone until you tick “follow
          f1fantasytools” again.
          {race.lockedAt && " Teams are already locked, so the deadline can't change."} Cancelling skips the race: no
          scores, and the next race opens.
        </p>
      </div>

      {/* 2. Points */}
      <div className={sub}>
        <h3 className="mb-1 font-semibold">Correct points</h3>
        <div className="flex flex-wrap gap-1">
          {[...drivers, ...cons].map((a) => {
            const p = ptsOf(a.id);
            return (
              <a
                key={a.id}
                href={q({ asset: a.id })}
                className={`rounded border px-1.5 py-0.5 text-xs ${a.id === asset?.id ? "border-navy bg-navy text-white" : "border-line"} ${p?.manual ? "font-bold" : ""}`}
              >
                {a.ticker} {p ? Number(p.total) : "–"}
                {p?.manual ? " ✎" : ""}
              </a>
            );
          })}
        </div>
        {asset && (
          <ActionForm action={act.setPointsAction} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="raceId" value={race.id} />
            <input type="hidden" name="assetId" value={asset.id} />
            <b className="pb-1.5">{asset.ticker}</b>
            {race.isSprint && (
              <label className="grid gap-0.5">
                <span className="text-xs text-muted">Sprint</span>
                <input name="S" inputMode="decimal" defaultValue={row?.sprintTotal ?? ""} className={field + " w-16"} />
              </label>
            )}
            <label className="grid gap-0.5">
              <span className="text-xs text-muted">Qualifying</span>
              <input name="Q" inputMode="decimal" defaultValue={row?.qualiTotal ?? ""} className={field + " w-16"} />
            </label>
            <label className="grid gap-0.5">
              <span className="text-xs text-muted">Race</span>
              <input name="R" inputMode="decimal" defaultValue={row?.raceTotal ?? ""} className={field + " w-16"} />
            </label>
            <SubmitButton>Save points</SubmitButton>
          </ActionForm>
        )}
        {manual.length > 0 && (
          <div className="mt-2 grid gap-1">
            <span className="text-xs text-muted">Typed by a commissioner (✎), kept even when f1fantasytools changes:</span>
            {manual.map((p) => {
              const id = p.stintId ? `s${p.stintId}` : `c${p.constructorId}`;
              const a = assets.find((x) => x.id === id);
              return (
                <ActionForm key={p.id} action={act.clearPointsAction} className="flex items-center gap-2">
                  <input type="hidden" name="raceId" value={race.id} />
                  <input type="hidden" name="assetId" value={id} />
                  <span>
                    {a?.ticker ?? id} {Number(p.total)}
                  </span>
                  <SubmitButton variant="quiet">Use f1fantasytools again</SubmitButton>
                </ActionForm>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-xs text-muted">Tap a driver or team, then type the session totals.</p>
      </div>

      {/* 3. Fix a team */}
      <div className={sub}>
        <h3 className="mb-1 font-semibold">Fix a team</h3>
        <div className="flex flex-wrap gap-1">
          {roster.map((p) => (
            <a
              key={p.id}
              href={q({ player: p.id })}
              className={`rounded border px-1.5 py-0.5 text-xs ${p.id === player?.id ? "border-navy bg-navy text-white" : "border-line"}`}
            >
              {p.name}
            </a>
          ))}
        </div>
        {player && team && (
          <ActionForm
            action={act.fixTeamAction}
            confirm={`Replace ${player.name}'s ${race.label} team?`}
            className="mt-2 flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="raceId" value={race.id} />
            <input type="hidden" name="playerId" value={player.id} />
            {SLOTS.map((s) => (
              <label key={s} className="grid gap-0.5">
                <span className="text-xs text-muted">{SLOT_LABEL[s]}</span>
                <select name={s} defaultValue={team[s] ?? ""} className={field}>
                  <option value="">—</option>
                  {(s === "team" ? cons : drivers).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ticker} {a.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <SubmitButton>Save team</SubmitButton>
          </ActionForm>
        )}
        <p className="mt-1 text-xs text-muted">
          For a team that should be different (a save that didn&apos;t go through, say). Prices are this race&apos;s; the budget
          penalty is worked out again.
        </p>
      </div>

      {/* 4. Prices */}
      <div className={sub}>
        <h3 className="mb-1 font-semibold">Prices</h3>
        {race.lockedAt ? (
          <p className="text-xs text-muted">{race.label} is locked, so its prices are fixed. Pick the open race to change prices.</p>
        ) : (
          <>
            <ActionForm action={act.overridePriceAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="raceId" value={race.id} />
              <label className="grid gap-0.5">
                <span className="text-xs text-muted">Driver or team</span>
                <select name="assetId" className={field} defaultValue="">
                  <option value="" disabled>
                    —
                  </option>
                  {[...drivers, ...cons].map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ticker} {a.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5">
                <span className="text-xs text-muted">Price for {race.label}</span>
                <input name="price" inputMode="decimal" className={`${field} w-24`} placeholder="e.g. 12.50" />
              </label>
              <SubmitButton>Set price</SubmitButton>
              <button name="clear" value="1" className="rounded border border-line px-2 py-1 text-xs font-semibold">
                Put formula price back
              </button>
            </ActionForm>
            <p className="mt-1 text-xs text-muted">
              A one-off price for this race only; the formula carries on from the next race.
              {overridden.length > 0 && <> Set by hand now: {overridden.map((a) => `${a.ticker} ${a.price.toFixed(2)}`).join(", ")}.</>}
            </p>

            <ActionForm action={act.setPricePeerAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="raceId" value={race.id} />
              <label className="grid gap-0.5">
                <span className="text-xs text-muted">New or substitute driver</span>
                <select name="personId" className={field} defaultValue="">
                  <option value="" disabled>
                    —
                  </option>
                  {people4.map((d) => (
                    <option key={d.id} value={d.personId}>
                      {d.ticker} {d.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5">
                <span className="text-xs text-muted">Starts at the price of</span>
                <select name="peerPersonId" className={field} defaultValue="">
                  <option value="" disabled>
                    —
                  </option>
                  {people4.map((d) => (
                    <option key={d.id} value={d.personId}>
                      {d.ticker} {d.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton>Save price peer</SubmitButton>
            </ActionForm>
            <p className="mt-1 text-xs text-muted">
              A driver new to the league (a substitute, a rookie) starts at their peer&apos;s price instead of the cheapest
              price. Drivers changing teams are picked up from f1fantasytools automatically.
              {peerRows.length > 0 && (
                <> This season: {peerRows.map((r) => `${tickers.get(r.personId)} ← ${tickers.get(r.peerPersonId)}`).join(", ")}.</>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
