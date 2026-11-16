import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { activityLog, invites, picks, players, races, users } from "@/db/schema";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyLink } from "@/components/copy-link";
import { getLeague } from "@/lib/league";
import { currentRace, rowToPicks } from "@/lib/team";
import { emptySlots } from "@/lib/lineup";
import { assetPrices } from "@/db/schema";
import { appUrl } from "@/lib/mail";
import { requireMember } from "@/lib/session";
import * as act from "@/app/actions";
import { Corrections } from "./corrections";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-lg border border-line bg-card">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-bold">{title}</h2>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

const chip = "rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ race?: string; asset?: string; player?: string }>;
}) {
  const params = await searchParams;
  const v = await requireMember();
  const db = getDb();
  const boss = v.isCommissioner;
  const claimant = alias(users, "claimant");

  const leagueId = v.player.leagueId;
  const [roster, league, pending, log] = await Promise.all([
    db
      .select({
        id: players.id,
        name: players.displayName,
        role: players.role,
        active: players.active,
        email: users.email,
        claimEmail: claimant.email,
        joinedAt: races.label,
      })
      .from(players)
      .leftJoin(users, eq(users.id, players.userId))
      .leftJoin(claimant, eq(claimant.id, players.claimRequestedBy))
      .leftJoin(races, eq(races.id, players.joinedAtRaceId))
      .where(eq(players.leagueId, leagueId))
      .orderBy(desc(players.active), players.displayName),
    getLeague(db, leagueId),
    db
      .select({ id: invites.id, email: invites.email, createdAt: invites.createdAt })
      .from(invites)
      .where(
        and(eq(invites.leagueId, leagueId), eq(invites.kind, "email"), eq(invites.active, true), isNull(invites.usedAt)),
      )
      .orderBy(desc(invites.createdAt)),
    db
      .select()
      .from(activityLog)
      .where(
        and(
          or(eq(activityLog.leagueId, leagueId), isNull(activityLog.leagueId)),
          // Routine 15-minute syncs only show when they fail.
          sql`not (${activityLog.action} = 'sync' and ${activityLog.result} = 'ok')`,
        ),
      )
      .orderBy(desc(activityLog.at))
      .limit(30),
  ]);

  const race = await currentRace(db);
  // Where each player's team stands for the current race (the column in Players).
  const teamState = new Map<number, { label: string; tone: "ok" | "warn" | "bad" | "muted" }>();
  if (race) {
    const rows = await db.select().from(picks).where(eq(picks.raceId, race.id));
    for (const p of roster) {
      const row = rows.find((r) => r.playerId === p.id);
      if (race.lockedAt) {
        teamState.set(
          p.id,
          !row
            ? { label: "No team", tone: "bad" }
            : row.origin === "random"
              ? { label: "Random team", tone: "warn" }
              : row.origin === "auto_filled"
                ? { label: "Own, auto-filled", tone: "warn" }
                : { label: "Own team", tone: "ok" },
        );
        continue;
      }
      if (!row) {
        teamState.set(p.id, { label: "Nothing saved yet", tone: "bad" });
        continue;
      }
      // Only whether the team is complete: going over budget can be a deliberate gamble,
      // so it isn't shown to anyone (commissioners play too) before the lock.
      const empty = emptySlots(rowToPicks(row)).length;
      teamState.set(
        p.id,
        empty ? { label: `Saved, ${empty} empty slot${empty > 1 ? "s" : ""}`, tone: "warn" } : { label: "✓ Saved, complete", tone: "ok" },
      );
    }
  }
  const toneClass = { ok: "text-up font-semibold", warn: "text-amber-600 font-semibold dark:text-amber-400", bad: "text-down font-semibold", muted: "text-muted" };
  const [priceCount] = race
    ? await db.select({ n: sql<number>`count(*)::int` }).from(assetPrices).where(eq(assetPrices.raceId, race.id))
    : [{ n: 0 }];
  const [lastSync] = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "sync"))
    .orderBy(desc(activityLog.at))
    .limit(1);
  const when = (d: Date) =>
    d.toLocaleString("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const names = new Map<string, string>();
  for (const r of await db
    .select({ id: users.id, name: players.displayName })
    .from(players)
    .innerJoin(users, eq(users.id, players.userId))
    .where(eq(players.leagueId, leagueId)))
    names.set(r.id, r.name);

  const claims = roster.filter((p) => p.claimEmail);
  const joinUrl = `${appUrl()}/join/${league.code}`;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-3 content-start">
        {!boss && (
          <p className="text-xs text-muted">Only commissioners can change things here; everyone can see it.</p>
        )}

        {boss && claims.length > 0 && (
          <Card title="Waiting for you" note="people asking to be linked to a profile">
            <ul className="grid gap-2">
              {claims.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    <b>{c.claimEmail}</b> says they are <b>{c.name}</b>
                  </span>
                  <ActionForm action={act.resolveClaim} className="ml-auto flex gap-1">
                    <input type="hidden" name="playerId" value={c.id} />
                    <SubmitButton name="approve" value="1">
                      Confirm
                    </SubmitButton>
                    <SubmitButton name="approve" value="0" variant="quiet">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Players" note={`${roster.filter((p) => p.active).length} active`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Name</th>
                  <th className="py-1 pr-2 font-semibold">Account</th>
                  {race && <th className="py-1 pr-2 font-semibold whitespace-nowrap">{race.label} team</th>}
                  {boss && <th className="py-1 font-semibold text-right">Manage</th>}
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id} className={`border-t border-line align-middle ${p.active ? "" : "opacity-50"}`}>
                    <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">
                      {p.name}{" "}
                      {p.role === "commissioner" && <span className={`${chip} bg-red/10 text-red`}>Comm</span>}
                      {!p.active && <span className={`${chip} bg-black/10`}>Inactive</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-muted">
                      {p.email ? (boss ? p.email : "signed in") : p.claimEmail ? "claim pending" : "not signed in yet"}
                    </td>
                    {race && (
                      <td className="py-1.5 pr-2 text-xs">
                        {(() => {
                          const st = teamState.get(p.id);
                          if (!st) return null;
                          // Players see saved / not saved; the details are for commissioners.
                          const label = boss || race.lockedAt ? st.label : st.tone === "bad" && st.label.startsWith("Nothing") ? st.label : "Saved";
                          return <span className={boss || race.lockedAt ? toneClass[st.tone] : "text-muted"}>{label}</span>;
                        })()}
                      </td>
                    )}
                    {boss && (
                      <td className="py-1.5">
                        <details className="text-right">
                          <summary className="cursor-pointer text-xs text-muted">edit</summary>
                          <div className="mt-1 grid gap-1 justify-items-end">
                            <ActionForm action={act.renamePlayer} className="flex gap-1">
                              <input type="hidden" name="playerId" value={p.id} />
                              <input
                                name="name"
                                defaultValue={p.name}
                                className="w-32 rounded border border-line bg-transparent px-1.5 py-0.5"
                              />
                              <SubmitButton variant="quiet">Rename</SubmitButton>
                            </ActionForm>
                            <div className="flex flex-wrap justify-end gap-1">
                              {p.email && (
                                <ActionForm action={act.setRole}>
                                  <input type="hidden" name="playerId" value={p.id} />
                                  <input
                                    type="hidden"
                                    name="role"
                                    value={p.role === "commissioner" ? "player" : "commissioner"}
                                  />
                                  <SubmitButton variant="quiet">
                                    {p.role === "commissioner" ? "Remove commissioner" : "Make commissioner"}
                                  </SubmitButton>
                                </ActionForm>
                              )}
                              <ActionForm action={act.setActive}>
                                <input type="hidden" name="playerId" value={p.id} />
                                <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                                <SubmitButton variant="quiet">{p.active ? "Deactivate" : "Reactivate"}</SubmitButton>
                              </ActionForm>
                              {p.id !== v.player.id && (
                                <ActionForm
                                  action={act.deletePlaceholder}
                                  confirm={`Remove ${p.name} completely? Their profile, every team they saved${p.email ? " and their sign-in" : ""} are deleted. This can't be undone.`}
                                >
                                  <input type="hidden" name="playerId" value={p.id} />
                                  <SubmitButton variant="quiet">Remove completely</SubmitButton>
                                </ActionForm>
                              )}
                              {roster.length > 1 && (
                                <ActionForm
                                  action={act.mergePlayers}
                                  confirm={`Merge ${p.name} into the profile you chose? ${p.name} will be removed; its sign-in and teams move over.`}
                                  className="flex gap-1"
                                >
                                  <input type="hidden" name="playerId" value={p.id} />
                                  <select
                                    name="intoId"
                                    defaultValue=""
                                    className="rounded border border-line bg-card px-1 py-0.5 text-xs"
                                    aria-label={`Same person as`}
                                  >
                                    <option value="" disabled>
                                      Same person as…
                                    </option>
                                    {roster
                                      .filter((o) => o.id !== p.id && !(o.email && p.email))
                                      .map((o) => (
                                        <option key={o.id} value={o.id}>
                                          {o.name}
                                        </option>
                                      ))}
                                  </select>
                                  <SubmitButton variant="quiet">Merge</SubmitButton>
                                </ActionForm>
                              )}
                              {p.email && p.role !== "commissioner" && (
                                <ActionForm
                                  action={act.unlink}
                                  confirm={`Unlink ${p.email} from ${p.name}? They'll need to claim the profile again.`}
                                >
                                  <input type="hidden" name="playerId" value={p.id} />
                                  <SubmitButton variant="quiet">Unlink account</SubmitButton>
                                </ActionForm>
                              )}
                            </div>
                          </div>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {boss && (
          <Card title="Email check">
            <ActionForm action={act.testEmail} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Sends a test email to {v.email}.</span>
              <SubmitButton variant="quiet">Send me a test email</SubmitButton>
            </ActionForm>
            <ActionForm action={act.sampleReminder} className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">The 24-hour reminder for the next race, as everyone will get it.</span>
              <SubmitButton variant="quiet">Send me a sample reminder</SubmitButton>
            </ActionForm>
          </Card>
        )}

        <Card title="Race control" note="the job runs every 15 minutes">
          {race ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Race</dt>
              <dd>
                <b>{race.label}</b> · {race.name}
                {race.isSprint && " · Sprint"}
              </dd>
              <dt className="text-muted">Deadline</dt>
              <dd>{race.deadline ? when(race.deadline) : "not set"}{race.deadlineManual && " (set by hand)"}</dd>
              <dt className="text-muted">Teams</dt>
              <dd>{race.lockedAt ? <b className="text-red">Locked {when(race.lockedAt)}</b> : "Open"}</dd>
              <dt className="text-muted">Results</dt>
              <dd className="capitalize">{race.results === "none" ? "Not started" : race.results}</dd>
              <dt className="text-muted">Prices</dt>
              <dd className={priceCount.n ? "" : "text-down"}>
                {priceCount.n ? `${priceCount.n} assets priced` : "None yet: import them below before the deadline"}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">No race yet. Press Sync now to load the calendar from f1fantasytools.</p>
          )}
          <p className="mt-2 text-xs text-muted">
            Last sync:{" "}
            {lastSync ? (
              <>
                {when(lastSync.at)}
                {lastSync.result !== "ok" && <span className="text-down"> · {lastSync.result}</span>}
              </>
            ) : (
              "never"
            )}
          </p>
          {boss && (
            <>
              <div className="mt-3 flex flex-wrap gap-1">
                <ActionForm action={act.syncNow}>
                  <SubmitButton>Sync now</SubmitButton>
                </ActionForm>
                {race && !race.lockedAt && (
                  <ActionForm
                    action={act.lockNow}
                    confirm={`Lock ${race.label} now, before the deadline? Empty and partial teams get filled.`}
                  >
                    <SubmitButton variant="quiet">Lock now</SubmitButton>
                  </ActionForm>
                )}
              </div>
              {race && (
                <>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold">Import prices for {race.label}</summary>
                    <ActionForm action={act.importPricesAction} className="mt-2">
                      <p className="mb-1 text-xs text-muted">
                        Paste from the sheet&apos;s Team Builder (columns A to H) or type one per line, e.g. VER 28.8.
                        Replaces those assets&apos; prices for this race.
                      </p>
                      <textarea
                        name="prices"
                        rows={6}
                        required
                        className="w-full rounded border border-line bg-transparent p-2 font-mono text-xs"
                        placeholder={"VER\t28.8\nANT\t27.5"}
                      />
                      <SubmitButton variant="quiet">Import prices</SubmitButton>
                    </ActionForm>
                  </details>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold">Rename {race.label}</summary>
                    <ActionForm action={act.renameRace} className="mt-2 flex gap-2">
                      <input type="hidden" name="raceId" value={race.id} />
                      <input
                        name="label"
                        defaultValue={race.label}
                        className="w-32 rounded border border-line bg-transparent px-2 py-1 uppercase"
                      />
                      <SubmitButton variant="quiet">Rename</SubmitButton>
                    </ActionForm>
                  </details>
                </>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-3 content-start">
        {boss && (
          <div id="corrections" className="scroll-mt-28">
            <Card title="Corrections" note="when a race or f1fantasytools doesn't go to plan">
              <Corrections db={db} leagueId={leagueId} params={params} defaultRaceId={race?.id ?? null} />
            </Card>
          </div>
        )}

        <Card title="Invite friends" note="anyone can">
          <p className="text-xs text-muted">League code</p>
          <p className={`text-2xl font-bold tracking-[0.2em] ${league.codeActive ? "" : "text-muted line-through"}`}>
            {league.code}
          </p>
          {!league.codeActive && <p className="text-xs text-down">Joining by code is paused.</p>}
          <p className="mt-2 text-xs text-muted">Or share this link (it fills in the code):</p>
          <CopyLink url={joinUrl} />
          <ActionForm action={act.inviteByEmail} className="mt-3 flex gap-2">
            <input
              name="email"
              type="email"
              required
              placeholder="friend@example.com"
              className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1"
            />
            <SubmitButton>Email invite</SubmitButton>
          </ActionForm>
          {boss && (
            <div className="mt-3 flex flex-wrap gap-1">
              <ActionForm
                action={act.leagueCode}
                confirm="Make a new code? The current code and link will stop working."
              >
                <SubmitButton name="mode" value="new" variant="quiet">
                  New code
                </SubmitButton>
              </ActionForm>
              <ActionForm action={act.leagueCode}>
                <SubmitButton name="mode" value={league.codeActive ? "pause" : "resume"} variant="quiet">
                  {league.codeActive ? "Pause joining" : "Resume joining"}
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {pending.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm">
              <li className="text-xs text-muted">Pending email invites</li>
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <span className="truncate">{i.email}</span>
                  {boss && (
                    <ActionForm action={act.cancelInvite} className="ml-auto">
                      <input type="hidden" name="inviteId" value={i.id} />
                      <SubmitButton variant="quiet">Cancel</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activity" note="latest 30">
          <ul className="grid gap-1 text-xs">
            {log.length === 0 && <li className="text-muted">Nothing yet.</li>}
            {log.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="text-muted whitespace-nowrap">
                  {l.at.toLocaleString("en-CA", {
                    timeZone: "America/Toronto",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span>
                  {names.get(l.actor) ?? (l.actor === "job" ? "Job" : "Someone")} · {l.action.replaceAll("_", " ")}
                  {l.result !== "ok" && <span className="text-down"> · {l.result}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
