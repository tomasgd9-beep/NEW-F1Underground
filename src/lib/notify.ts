// Emails the scheduled job sends: the 24-hour deadline reminder, the summary after
// a race is final, and an alert to commissioners when the job itself fails.
// Each email goes out once per player per race (the reminders table remembers it).
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activityLog, leagues, picks, players, races, reminders, seasons, users } from "@/db/schema";
import { loadLeague } from "@/lib/league-data";
import { logActivity } from "@/lib/league";
import { appUrl, escapeHtml, sendMail } from "@/lib/mail";
import { budgetPenalty, emptySlots, teamPrice, type Slot } from "@/lib/lineup";
import { standings, teamScore } from "@/lib/standings";
import { myPicks, rowToPicks, teamAssets, type Race } from "@/lib/team";

const DAY = 24 * 3600_000;

/** "Fri, Nov 20, 11:00 PM ET" — the league plays from Toronto. */
export function etTime(d: Date) {
  return (
    d.toLocaleString("en-US", {
      timeZone: "America/Toronto",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET"
  );
}

type Recipient = {
  playerId: number;
  leagueId: number;
  name: string;
  email: string;
  role: string;
};

async function recipients(db: Db): Promise<Recipient[]> {
  return db
    .select({
      playerId: players.id,
      leagueId: players.leagueId,
      name: players.displayName,
      email: users.email,
      role: players.role,
    })
    .from(players)
    .innerJoin(users, eq(users.id, players.userId))
    .where(and(eq(players.active, true), isNotNull(users.email))) as Promise<Recipient[]>;
}

async function alreadySent(db: Db, playerId: number, raceId: number, type: string) {
  const [r] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.playerId, playerId), eq(reminders.raceId, raceId), eq(reminders.type, type)))
    .limit(1);
  return !!r;
}

/** Marks first, then sends, so two overlapping runs can't email the same person twice. */
async function claim(db: Db, playerId: number, raceId: number, type: string) {
  const rows = await db
    .insert(reminders)
    .values({ playerId, raceId, type })
    .onConflictDoNothing()
    .returning({ id: reminders.id });
  return rows.length > 0;
}

/** Sends one email; if it fails, the mark is removed so the next run tries again. */
async function deliver(db: Db, playerId: number, raceId: number, type: string, send: () => Promise<void>) {
  try {
    await send();
  } catch (e) {
    await db
      .delete(reminders)
      .where(and(eq(reminders.playerId, playerId), eq(reminders.raceId, raceId), eq(reminders.type, type)));
    throw e;
  }
}

/** Real email is configured (or we're on the local demo, where emails are printed). */
export function canEmail() {
  return !!process.env.EMAIL_SERVER || (process.env.DATABASE_URL ?? "").startsWith("pglite:");
}

export type TeamStatus = {
  /** Slots still empty (labels like "D3", "C"); all six when no team is saved. */
  empty: string[];
  saved: boolean;
  price: number;
  /** Points lost to the budget rule (0 or negative). */
  penalty: number;
  budget: number;
};

const SLOT_LABEL: Record<Slot, string> = { double: "D1 (×2)", d1: "D2", d2: "D3", d3: "D4", d4: "D5", team: "C" };

/** Where a player's team stands for a race: what's missing and what the budget rule would cost. */
export async function teamStatus(db: Db, playerId: number, race: Race): Promise<TeamStatus> {
  const row = await myPicks(db, playerId, race.id);
  const picks = rowToPicks(row);
  const byId = new Map((await teamAssets(db, race)).map((a) => [a.id, a]));
  const price = teamPrice(picks, byId);
  const [s] = await db.select({ budget: seasons.budget }).from(seasons).where(eq(seasons.id, race.seasonId));
  const budget = Number(s?.budget ?? 100);
  return {
    saved: !!row,
    empty: emptySlots(picks).map((x) => SLOT_LABEL[x]),
    price,
    penalty: budgetPenalty(price, budget),
    budget,
  };
}

/** The sentence(s) about the player's team in the reminder. */
export function statusLines(t: TeamStatus): string[] {
  if (!t.saved || t.empty.length === 6) {
    return ["You haven't saved a team yet. If you don't save one before the deadline, you'll get a random team."];
  }
  const out: string[] = [];
  if (t.empty.length) {
    const n = t.empty.length;
    out.push(
      `Your team has ${n} empty slot${n > 1 ? "s" : ""} (${t.empty.join(", ")}). ` +
        `If you leave ${n > 1 ? "them" : "it"} empty, ${n > 1 ? "they'll" : "it'll"} be filled automatically at the deadline with the best picks your budget allows.`,
    );
  }
  if (t.penalty < 0) {
    const over = (t.price - t.budget).toFixed(2);
    out.push(
      `Your team costs ${t.price.toFixed(2)}, ${over} over the ${t.budget} budget: that's −${Math.abs(t.penalty)} points this race. Swap in someone cheaper to avoid it.`,
    );
  }
  if (!out.length) {
    out.push(
      `Your team is complete (${t.price.toFixed(2)} / ${t.budget}). You can still change it until the deadline.`,
    );
  }
  return out;
}

/** The reminder email itself (also used by Admin's "send me a sample"). */
export function reminderEmail(
  name: string,
  race: { label: string; name: string },
  deadline: Date,
  status: TeamStatus,
  now = new Date(),
  /** Commissioners also get a message to paste into the league's WhatsApp group. */
  leagueMessage?: string,
) {
  const hours = hoursUntil(deadline, now);
  const url = `${appUrl()}/team`;
  const lines = statusLines(status);
  const action = !status.saved || status.empty.length || status.penalty < 0 ? "Fix my team" : "Open My team";
  const wa = leagueMessage ? whatsappBlock(leagueMessage) : { text: "", html: "" };
  return {
    subject: `F1 Underground deadline - ${race.label} locks in ${hours}hs`,
    text: `Hi ${name},\n\n${race.name} teams lock ${etTime(deadline)} (in about ${hours} hours).\n${lines.join("\n")}\n\n${url}\n${wa.text}`,
    html:
      `<p>Hi ${escapeHtml(name)},</p><p><b>${escapeHtml(race.name)}</b> teams lock <b>${etTime(deadline)}</b> (in about ${hours} hours).</p>` +
      lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") +
      `<p><a href="${url}">${action}</a></p>` +
      wa.html,
  };
}

function hoursUntil(deadline: Date, now: Date) {
  return Math.max(1, Math.round((deadline.getTime() - now.getTime()) / 3600_000));
}

/** The part of a commissioner's email meant for the league chat: the message, ready to copy, and a WhatsApp button. */
export function whatsappBlock(message: string) {
  const wa = `https://wa.me/?text=${encodeURIComponent(message)}`;
  return {
    text: `\n---\nFor the league WhatsApp (copy and paste):\n\n${message}\n\nOr open it in WhatsApp: ${wa}\n`,
    html:
      `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">` +
      `<p style="margin:0 0 6px"><b>For the league WhatsApp</b> (copy and paste, or tap the button)</p>` +
      `<div style="white-space:pre-wrap;background:#f4f4f4;border-radius:8px;padding:12px;font-family:inherit">${escapeHtml(message)}</div>` +
      `<p><a href="${wa}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:8px 14px;border-radius:6px">Open in WhatsApp</a></p>`,
  };
}

/** Active players of a league and their saved team (if any) for a race. */
async function leagueTeams(db: Db, leagueId: number, raceId: number) {
  const members = await db
    .select({ id: players.id, name: players.displayName })
    .from(players)
    .where(and(eq(players.leagueId, leagueId), eq(players.active, true)))
    .orderBy(players.displayName);
  const rows = await db
    .select({ playerId: picks.playerId, origin: picks.origin })
    .from(picks)
    .where(eq(picks.raceId, raceId));
  return members.map((m) => ({ ...m, origin: rows.find((r) => r.playerId === m.id)?.origin ?? null }));
}

/** The group-chat message a day before the deadline: who still has to save a team (never budgets or picks). */
export async function leagueReminderMessage(
  db: Db,
  leagueId: number,
  race: { id: number; label: string; name: string },
  deadline: Date,
  now = new Date(),
) {
  const teams = await leagueTeams(db, leagueId, race.id);
  const missing = teams.filter((t) => !t.origin).map((t) => t.name);
  const lines = [
    `⏰ F1 Underground: ${race.name} (${race.label}) teams lock ${etTime(deadline)}, in about ${hoursUntil(deadline, now)} hours.`,
    missing.length
      ? `✅ ${teams.length - missing.length} of ${teams.length} teams saved.\n⏳ Still to save: ${missing.join(", ")}.`
      : `✅ Everyone has saved a team.`,
    `No team at the deadline means a random one.`,
    `Build yours: ${appUrl()}/team`,
  ];
  return lines.join("\n");
}

/** The group-chat message once teams are locked: how each team came about, and where to see the picks. */
export async function leagueLockMessage(db: Db, leagueId: number, race: { id: number; label: string; name: string }) {
  const teams = await leagueTeams(db, leagueId, race.id);
  const names = (o: string | null) => teams.filter((t) => t.origin === o).map((t) => t.name);
  const own = names("manual");
  const auto = names("auto_filled");
  const random = names("random");
  const none = names(null);
  const lines = [
    `🔒 ${race.name} (${race.label}) teams are locked.`,
    `✅ ${own.length} own team${own.length === 1 ? "" : "s"}`,
    auto.length ? `🧩 Auto-filled empty slots: ${auto.join(", ")}` : "",
    random.length ? `🎲 Random team: ${random.join(", ")}` : "",
    none.length ? `⚠️ No team: ${none.join(", ")}` : "",
    `Everyone's picks are now visible: ${appUrl()}/league`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Reminder to every signed-in player once the next deadline is less than 24 hours away. */
export async function sendDeadlineReminders(db: Db, now = new Date()) {
  if (!canEmail()) return 0;
  const [race] = await db
    .select()
    .from(races)
    .where(and(isNotNull(races.deadline), gt(races.deadline, now), sql`${races.lockedAt} is null`))
    .orderBy(races.deadline)
    .limit(1);
  if (!race?.deadline || race.deadline.getTime() - now.getTime() > DAY) return 0;
  const deadline = race.deadline;

  let sent = 0;
  for (const r of await recipients(db)) {
    if (await alreadySent(db, r.playerId, race.id, "24h")) continue;
    const status = await teamStatus(db, r.playerId, race);
    if (!(await claim(db, r.playerId, race.id, "24h"))) continue;
    const forLeague =
      r.role === "commissioner" ? await leagueReminderMessage(db, r.leagueId, race, deadline, now) : undefined;
    const mail = reminderEmail(r.name, race, deadline, status, now, forLeague);
    await deliver(db, r.playerId, race.id, "24h", () => sendMail(r.email, mail.subject, mail.text, mail.html));
    sent++;
  }
  if (sent) await logActivity(db, "job", "reminders_sent", { race: race.label, sent });
  return sent;
}

/**
 * After a race turns final: each player gets their race score and place, and the
 * top of the season table. Only for races that finished in the last 4 days, so
 * imported history never triggers emails.
 */
export async function sendRaceSummaries(db: Db, now = new Date()) {
  if (!canEmail()) return 0;
  const finals = await db
    .select()
    .from(races)
    .where(
      and(eq(races.results, "final"), isNotNull(races.lockedAt), gt(races.deadline, new Date(now.getTime() - 4 * DAY))),
    );
  let sent = 0;
  const people = await recipients(db);
  for (const race of finals) {
    for (const leagueId of new Set(people.map((p) => p.leagueId))) {
      const todo = [];
      for (const r of people.filter((p) => p.leagueId === leagueId)) {
        if (!(await alreadySent(db, r.playerId, race.id, "summary"))) todo.push(r);
      }
      if (!todo.length) continue;
      const data = await loadLeague(db, leagueId, todo[0].playerId, race.seasonId);
      if (!data) continue;
      const upto = data.races.findIndex((x) => x.id === race.id);
      if (upto < 0) continue;
      const raceIds = data.races
        .slice(0, upto + 1)
        .filter((x) => data.teams[x.id])
        .map((x) => x.id);
      const score = (pid: number, rid: number) => {
        const t = data.teams[rid]?.[pid];
        return t ? teamScore(t, data.points[rid]) : null;
      };
      const ids = data.players.map((p) => p.id);
      const season = standings(ids, raceIds, score);
      const raceOnly = standings(ids, [race.id], score);
      const name = (id: number) => data.players.find((p) => p.id === id)?.name ?? "?";
      const top = season
        .slice(0, 5)
        .map((s) => `${s.rank}. ${name(s.playerId)} ${s.total}`)
        .join("\n");
      const winner = raceOnly[0];
      const [league] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
      for (const r of todo) {
        if (!(await claim(db, r.playerId, race.id, "summary"))) continue;
        const mine = raceOnly.find((s) => s.playerId === r.playerId);
        const me = season.find((s) => s.playerId === r.playerId);
        const move = me?.move ? (me.move > 0 ? ` (up ${me.move})` : ` (down ${-me.move})`) : "";
        const url = `${appUrl()}/league`;
        const lines = [
          `${race.name} is final.`,
          mine
            ? `You scored ${mine.total} (${ordinal(mine.rank)} of ${raceOnly.length} this race).`
            : "You didn't have a team this race.",
          me ? `Season: ${ordinal(me.rank)}${move}, ${me.total} points.` : "",
          winner ? `Race winner: ${name(winner.playerId)} with ${winner.total}.` : "",
        ].filter(Boolean);
        await deliver(db, r.playerId, race.id, "summary", () =>
          sendMail(
            r.email,
            `${race.label} results: ${mine ? `you scored ${mine.total}` : "final standings"}`,
            `Hi ${r.name},\n\n${lines.join("\n")}\n\n${league?.name ?? "League"} top 5:\n${top}\n\n${url}\n`,
            `<p>Hi ${escapeHtml(r.name)},</p><p>${lines.map(escapeHtml).join("<br>")}</p>` +
              `<p><b>Top 5</b><br>${top.split("\n").map(escapeHtml).join("<br>")}</p><p><a href="${url}">Open the League page</a></p>`,
          ),
        );
        sent++;
      }
    }
    if (sent)
      await logActivity(db, "job", "summaries_sent", {
        race: race.label,
        sent,
      });
  }
  return sent;
}

/**
 * Once a race's teams lock, each commissioner gets a short email with the message for
 * the league chat. Only for races locked in the last 2 days, so imported history never triggers it.
 */
export async function sendLockNotices(db: Db, now = new Date()) {
  if (!canEmail()) return 0;
  const since = new Date(now.getTime() - 2 * DAY);
  const locked = await db
    .select()
    .from(races)
    .where(and(isNotNull(races.lockedAt), gt(races.lockedAt, since), gt(races.deadline, since)));
  let sent = 0;
  const bosses = (await recipients(db)).filter((r) => r.role === "commissioner");
  for (const race of locked) {
    for (const b of bosses) {
      if (await alreadySent(db, b.playerId, race.id, "locked")) continue;
      const message = await leagueLockMessage(db, b.leagueId, race);
      if (!(await claim(db, b.playerId, race.id, "locked"))) continue;
      const wa = whatsappBlock(message);
      const when = etTime(race.lockedAt!);
      await deliver(db, b.playerId, race.id, "locked", () =>
        sendMail(
          b.email,
          `${race.label} teams locked`,
          `Hi ${b.name},\n\n${race.name} teams locked at ${when}.\n${wa.text}`,
          `<p>Hi ${escapeHtml(b.name)},</p><p><b>${escapeHtml(race.name)}</b> teams locked at ${when}.</p>${wa.html}`,
        ),
      );
      sent++;
    }
    if (sent) await logActivity(db, "job", "lock_notices_sent", { race: race.label, sent });
  }
  return sent;
}

function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Email every commissioner when the scheduled job fails; at most once every 12 hours. */
export async function alertCommissioners(db: Db, error: string, now = new Date()) {
  if (!canEmail()) return 0;
  const [last] = await db
    .select({ at: activityLog.at })
    .from(activityLog)
    .where(eq(activityLog.action, "job_alert"))
    .orderBy(desc(activityLog.at))
    .limit(1);
  if (last && now.getTime() - last.at.getTime() < DAY / 2) return 0;
  const bosses = await db
    .select({ email: users.email, name: players.displayName })
    .from(players)
    .innerJoin(users, eq(users.id, players.userId))
    .where(and(eq(players.role, "commissioner"), eq(players.active, true)));
  const url = `${appUrl()}/admin`;
  for (const b of bosses) {
    if (!b.email) continue;
    await sendMail(
      b.email,
      "F1 Underground: the score job failed",
      `Hi ${b.name},\n\nThe scheduled job couldn't update the league:\n${error}\n\nNothing was changed. If f1fantasytools changed its page, points can be entered on the Admin page until it's fixed.\n${url}\n`,
    );
  }
  await logActivity(db, "job", "job_alert", { error, sentTo: bosses.length });
  return bosses.length;
}
