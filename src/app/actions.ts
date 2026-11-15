"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { ActionResult } from "@/components/action-form";
import * as league from "@/lib/league";
import { sendInviteEmail } from "@/lib/mail";
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
    await league.joinAsNewPlayer(getDb(), { id: v.userId }, str(f, "token"), str(f, "name"));
  });
  if (res?.error) return res;
  redirect("/team");
}

export async function joinClaim(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const res = await attempt(async () => {
    await league.requestClaim(getDb(), { id: v.userId }, str(f, "token"), num(f, "playerId"));
  });
  if (res?.error) return res;
  redirect("/welcome");
}

/* ───────────── Invites (any member) ───────────── */

export async function inviteByEmail(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(async () => {
    const inv = await league.createEmailInvite(getDb(), v.userId, str(f, "email"));
    await sendInviteEmail(inv.email!, v.player?.displayName ?? "A friend", inv.token);
    return `Invite sent to ${inv.email}.`;
  });
}

/* ───────────── Commissioner ───────────── */

export async function resetLink(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  return attempt(async () => {
    const makeNew = str(f, "mode") === "new";
    await league.resetJoinLink(getDb(), v.userId, makeNew);
    return makeNew ? "New join link made; the old one no longer works." : "Join link turned off.";
  });
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
