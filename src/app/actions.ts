"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { ActionResult } from "@/components/action-form";
import * as league from "@/lib/league";
import { eq } from "drizzle-orm";
import { races } from "@/db/schema";
import { sendInviteEmail, sendMail } from "@/lib/mail";
import { leagueReminderMessage, reminderEmail, teamStatus } from "@/lib/notify";
import { upcomingRace } from "@/lib/races";
import { requireViewer } from "@/lib/session";

/** Run a league operation and turn rule errors into a message for the form. */
async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const ok = await fn();
    revalidatePath("/admin");
    return { ok: ok || undefined };
  } catch (e) {
    if (e instanceof league.LeagueError) return { error: e.message };
    console.error(e);
    return { error: "Something went wrong. Try again." };
  }
}

const num = (f: FormData, k: string) => Number(f.get(k));
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

/* ───────────── Joining ───────────── */

export async function joinNew(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const res = await attempt(async () => {
    await league.joinAsNewPlayer(getDb(), { id: v.userId }, str(f, "key"), str(f, "name"));
  });
  if (res?.error) return res;
  redirect("/team");
}

export async function joinClaim(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const res = await attempt(async () => {
    await league.requestClaim(getDb(), { id: v.userId }, str(f, "key"), num(f, "playerId"));
  });
  if (res?.error) return res;
  redirect("/welcome");
}

/* ───────────── Invites (any member) ───────────── */

export async function inviteByEmail(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(async () => {
    const inv = await league.createEmailInvite(getDb(), v.userId, str(f, "email"));
    try {
      await sendInviteEmail(inv.email!, v.player?.displayName ?? "A friend", inv.token);
    } catch (e) {
      console.error("invite email failed:", e);
      throw new league.LeagueError("The invite email couldn't be sent. Share the join link instead.");
    }
    return `Invite sent to ${inv.email}.`;
  });
}

/* ───────────── Commissioner ───────────── */

export async function leagueCode(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(async () => {
    const mode = str(f, "mode");
    if (mode === "new") {
      const l = await league.regenerateCode(getDb(), v.userId);
      return `New code ${l.code}. The old one no longer works.`;
    }
    await league.setCodeActive(getDb(), v.userId, mode === "resume");
    return mode === "resume" ? "Joining by code is on." : "Joining by code is paused. Email invites still work.";
  });
}

export async function withdrawClaim(): Promise<void> {
  const v = await requireViewer();
  await league.withdrawClaim(getDb(), v.userId);
  redirect("/welcome");
}

export async function cancelInvite(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(() => league.cancelInvite(getDb(), v.userId, num(f, "inviteId")));
}

export async function addPlayer(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(async () => {
    const p = await league.addPlayer(getDb(), v.userId, str(f, "name"));
    return `Added ${p.displayName}.`;
  });
}

export async function renamePlayer(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(() => league.renamePlayer(getDb(), v.userId, num(f, "playerId"), str(f, "name")));
}

export async function setRole(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const role = str(f, "role") === "commissioner" ? "commissioner" : "player";
  return attempt(() => league.setRole(getDb(), v.userId, num(f, "playerId"), role));
}

export async function setActive(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(() => league.setPlayerActive(getDb(), v.userId, num(f, "playerId"), str(f, "active") === "1"));
}

export async function unlink(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(() => league.unlinkPlayer(getDb(), v.userId, num(f, "playerId")));
}

export async function resolveClaim(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(() => league.resolveClaim(getDb(), v.userId, num(f, "playerId"), str(f, "approve") === "1"));
}

/** Commissioner: send a test email to yourself and show the exact error if it fails. */
export async function testEmail(): Promise<ActionResult> {
  const v = await requireViewer();
  if (!v.isCommissioner) return { error: "Only commissioners can do that." };
  if (!v.email) return { error: "Your account has no email address." };
  try {
    await sendMail(v.email, "F1 Underground test email", "If you can read this, league emails work.");
    return { ok: `Sent to ${v.email}. Check your inbox (and spam).` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Sending failed: ${msg}` };
  }
}

/** Commissioner: the real 24-hour reminder for the next race, sent only to yourself (nothing is recorded). */
export async function sampleReminder(): Promise<ActionResult> {
  const v = await requireViewer();
  if (!v.isCommissioner) return { error: "Only commissioners can do that." };
  if (!v.email || !v.player) return { error: "Your account has no email address." };
  const player = v.player;
  const db = getDb();
  const race = await upcomingRace(db);
  if (!race?.deadline) return { error: "No upcoming race with a deadline yet." };
  const [full] = await db.select().from(races).where(eq(races.id, race.id));
  const at = new Date(race.deadline.getTime() - 24 * 3600_000);
  const mail = reminderEmail(
    player.displayName,
    race,
    race.deadline,
    await teamStatus(db, player.id, full),
    at,
    await leagueReminderMessage(db, player.leagueId, full, race.deadline, at),
  );
  try {
    await sendMail(v.email, mail.subject, mail.text, mail.html);
    return { ok: `Sample reminder sent to ${v.email}.` };
  } catch (e) {
    return { error: `Sending failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function deletePlaceholder(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(() => league.removePlayer(getDb(), v.userId, num(f, "playerId")));
}

export async function mergePlayers(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const into = num(f, "intoId");
  if (!into) return { error: "Choose who this profile is." };
  return attempt(() => league.mergePlayers(getDb(), v.userId, num(f, "playerId"), into));
}

/* ───────────── Race control (commissioners) ───────────── */

async function commissionerOrError() {
  const v = await requireViewer();
  if (!v.isCommissioner) throw new league.LeagueError("Only commissioners can do that.");
  return v;
}

export async function syncNow(): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { runScheduledJob } = await import("@/lib/job");
    let r;
    try {
      r = await runScheduledJob(getDb(), v.userId);
    } catch (e) {
      const msg = e instanceof Error ? (e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message) : String(e);
      throw new league.LeagueError(`Sync failed: ${msg}`);
    }
    return [
      `Synced: ${r.sync?.current} (${r.sync?.state}), next ${r.sync?.next ?? "none"}, ${r.sync?.points} assets scored.`,
      r.lock ? `Locked ${r.lock.race}.` : "",
      r.prices ? `Priced ${r.prices.race}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

export async function lockNow(): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { currentRace } = await import("@/lib/team");
    const { lockRace, xpForLock } = await import("@/lib/sync");
    const { fetchExpectedPoints } = await import("@/lib/fft");
    const db = getDb();
    const race = await currentRace(db);
    if (!race) throw new league.LeagueError("No race is open.");
    if (race.lockedAt) throw new league.LeagueError(`${race.label} is already locked.`);
    const { xp, source } = await xpForLock(db, race, (round) => fetchExpectedPoints(round));
    let res;
    try {
      res = await lockRace(db, race, xp, { force: true, actor: v.userId, xpSource: source });
    } catch (e) {
      throw new league.LeagueError(e instanceof Error ? e.message : String(e));
    }
    const l = res?.leagues[0];
    return l
      ? `Locked ${race.label}: ${l.kept} kept, ${l.autoFilled} auto-filled, ${l.random} random.`
      : `Locked ${race.label}.`;
  });
}

export async function importPricesAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { currentRace } = await import("@/lib/team");
    const { importPrices } = await import("@/lib/sync");
    const db = getDb();
    const race = await currentRace(db);
    if (!race) throw new league.LeagueError("No race is open.");
    if (race.lockedAt) throw new league.LeagueError(`${race.label} is locked; its prices are frozen.`);
    const r = await importPrices(db, race, str(f, "prices"));
    await league.logActivity(db, v.userId, "prices_imported", { race: race.label, set: r.set }, {
      leagueId: v.player?.leagueId,
    });
    return `Set ${r.set} prices for ${race.label}.${r.unknown.length ? ` Not recognised: ${r.unknown.join(", ")}.` : ""}`;
  });
}

export async function renameRace(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { races } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const label = str(f, "label").trim().toUpperCase();
    if (!/^[A-Z0-9 ]{2,12}$/.test(label)) throw new league.LeagueError("Use up to 12 letters and numbers, e.g. R23 VEG.");
    await getDb().update(races).set({ label }).where(eq(races.id, num(f, "raceId")));
    await league.logActivity(getDb(), v.userId, "race_renamed", { label }, { leagueId: v.player?.leagueId });
    return `Renamed to ${label}.`;
  });
}

/* ───────────── Corrections (commissioners) ───────────── */

export async function updateRaceAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { updateRace, torontoToUtc } = await import("@/lib/corrections");
    const status = str(f, "status") as "scheduled" | "delayed" | "cancelled" | "relocated";
    // A changed time always wins over the "follow f1fantasytools" tick.
    const typed = str(f, "deadline");
    const changed = typed !== "" && typed !== str(f, "was");
    const deadline = f.get("auto") && !changed ? ("auto" as const) : torontoToUtc(typed);
    await updateRace(getDb(), v.userId, num(f, "raceId"), { status, deadline });
    return status === "cancelled" ? "Saved. The race is skipped; the next race is open." : "Saved.";
  });
}

export async function setPointsAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { setPoints } = await import("@/lib/corrections");
    const n = (k: string) => {
      const raw = str(f, k).trim();
      if (raw === "") return null;
      const x = Number(raw.replace(",", "."));
      if (!Number.isFinite(x)) throw new league.LeagueError("Points must be numbers.");
      return x;
    };
    const Q = n("Q"), R = n("R");
    if (Q == null || R == null) throw new league.LeagueError("Fill in qualifying and race points (0 if none).");
    await setPoints(getDb(), v.userId, num(f, "raceId"), str(f, "assetId"), { S: n("S"), Q, R });
    return "Points saved. The job won't overwrite them.";
  });
}

export async function clearPointsAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { clearPointsCorrection } = await import("@/lib/corrections");
    await clearPointsCorrection(getDb(), v.userId, num(f, "raceId"), str(f, "assetId"));
    return "Correction removed; the next run takes f1fantasytools' numbers again.";
  });
}

export async function fixTeamAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const v = await commissionerOrError();
    const { fixTeam } = await import("@/lib/corrections");
    const { SLOTS } = await import("@/lib/lineup");
    const team = Object.fromEntries(SLOTS.map((s) => [s, str(f, s) || undefined]));
    await fixTeam(getDb(), v.userId, num(f, "raceId"), num(f, "playerId"), team);
    return "Team saved.";
  });
}
