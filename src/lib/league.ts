// Membership rules: invites, joining, claiming a 2026 profile, roles.
// Every function takes the database as its first argument so tests can run it
// against PGlite and the app against Neon.
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activityLog, invites, players, races, users } from "@/db/schema";

export class LeagueError extends Error {}

export type Player = typeof players.$inferSelect;
export type Invite = typeof invites.$inferSelect;

export function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function logActivity(
  db: Db,
  actor: string,
  action: string,
  detail?: Record<string, unknown>,
  result = "ok",
) {
  await db.insert(activityLog).values({ actor, action, detail, result });
}

export async function getPlayerForUser(db: Db, userId: string): Promise<Player | undefined> {
  const [p] = await db.select().from(players).where(eq(players.userId, userId)).limit(1);
  return p;
}

export async function requireCommissioner(db: Db, userId: string): Promise<Player> {
  const p = await getPlayerForUser(db, userId);
  if (!p || !p.active || p.role !== "commissioner") {
    throw new LeagueError("Only commissioners can do that.");
  }
  return p;
}

async function requireActivePlayer(db: Db, userId: string): Promise<Player> {
  const p = await getPlayerForUser(db, userId);
  if (!p || !p.active) throw new LeagueError("Only league members can do that.");
  return p;
}

/** The next race whose deadline hasn't passed: a new joiner's points start there. */
export async function nextRaceId(db: Db, now = new Date()): Promise<number | null> {
  const [r] = await db
    .select({ id: races.id })
    .from(races)
    .where(and(gt(races.deadline, now), ne(races.status, "cancelled")))
    .orderBy(asc(races.deadline))
    .limit(1);
  return r?.id ?? null;
}

/**
 * The league creator(s): emails listed in BOOTSTRAP_COMMISSIONER_EMAILS become
 * commissioners on first sign-in, so the league can start with no invite.
 */
export async function ensureBootstrapCommissioner(
  db: Db,
  user: { id: string; email?: string | null; name?: string | null },
  bootstrapEmails: string[],
): Promise<Player | undefined> {
  const email = user.email?.toLowerCase();
  if (!email || !bootstrapEmails.map((e) => e.trim().toLowerCase()).includes(email)) return;
  const existing = await getPlayerForUser(db, user.id);
  if (existing) return existing;
  const displayName = await uniqueName(db, user.name || email.split("@")[0]);
  const [p] = await db
    .insert(players)
    .values({ displayName, userId: user.id, role: "commissioner" })
    .returning();
  await logActivity(db, user.id, "bootstrap_commissioner", { playerId: p.id });
  return p;
}

async function uniqueName(db: Db, base: string): Promise<string> {
  const clean = base.trim().slice(0, 40) || "Player";
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? clean : `${clean} ${i}`;
    const [taken] = await db
      .select({ id: players.id })
      .from(players)
      .where(sql`lower(${players.displayName}) = lower(${name})`)
      .limit(1);
    if (!taken) return name;
  }
  throw new LeagueError("Couldn't find a free name.");
}

/* ───────────────────────────── Invites ───────────────────────────── */

/** The current shareable join link (created on first request by any member). */
export async function getOrCreateJoinLink(db: Db, userId: string): Promise<Invite> {
  await requireActivePlayer(db, userId);
  const [existing] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.kind, "link"), eq(invites.active, true)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(invites)
    .values({ kind: "link", token: newToken(), invitedByUserId: userId })
    .returning();
  await logActivity(db, userId, "join_link_created", { inviteId: created.id });
  return created;
}

/** Commissioner: kill the current join link (and optionally make a new one). */
export async function resetJoinLink(db: Db, userId: string, makeNew: boolean): Promise<Invite | null> {
  await requireCommissioner(db, userId);
  await db
    .update(invites)
    .set({ active: false })
    .where(and(eq(invites.kind, "link"), eq(invites.active, true)));
  let created: Invite | null = null;
  if (makeNew) {
    [created] = await db
      .insert(invites)
      .values({ kind: "link", token: newToken(), invitedByUserId: userId })
      .returning();
  }
  await logActivity(db, userId, makeNew ? "join_link_regenerated" : "join_link_disabled");
  return created;
}

const emailSchema = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Any member: invite someone by email. Returns the invite; the caller sends the email. */
export async function createEmailInvite(db: Db, userId: string, rawEmail: string): Promise<Invite> {
  await requireActivePlayer(db, userId);
  const email = rawEmail.trim().toLowerCase();
  if (!emailSchema.test(email)) throw new LeagueError("That doesn't look like an email address.");
  const [member] = await db
    .select({ id: players.id })
    .from(players)
    .innerJoin(users, eq(users.id, players.userId))
    .where(eq(users.email, email))
    .limit(1);
  if (member) throw new LeagueError("That person is already in the league.");
  // Reuse a pending invite to the same address rather than piling them up.
  const [pending] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.kind, "email"), eq(invites.email, email), eq(invites.active, true), isNull(invites.usedAt)))
    .limit(1);
  if (pending) return pending;
  const [created] = await db
    .insert(invites)
    .values({ kind: "email", email, token: newToken(), invitedByUserId: userId })
    .returning();
  await logActivity(db, userId, "email_invite_created", { inviteId: created.id, email });
  return created;
}

export async function cancelInvite(db: Db, userId: string, inviteId: number) {
  await requireCommissioner(db, userId);
  await db.update(invites).set({ active: false }).where(eq(invites.id, inviteId));
  await logActivity(db, userId, "invite_cancelled", { inviteId });
}

/** A usable invite for this token, or null. Email invites work once. */
export async function findUsableInvite(db: Db, token: string): Promise<Invite | null> {
  const [inv] = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
  if (!inv || !inv.active) return null;
  if (inv.kind === "email" && inv.usedAt) return null;
  return inv;
}

async function consumeInvite(db: Db, inv: Invite, userId: string) {
  if (inv.kind === "email") {
    await db.update(invites).set({ usedAt: new Date(), usedByUserId: userId }).where(eq(invites.id, inv.id));
  }
}

/* ───────────────────────────── Joining ───────────────────────────── */

/** 2026 profiles nobody has linked or claimed yet (offered on the join page). */
export async function unclaimedPlayers(db: Db): Promise<Player[]> {
  return db
    .select()
    .from(players)
    .where(and(isNull(players.userId), isNull(players.claimRequestedBy), eq(players.active, true)))
    .orderBy(asc(players.displayName));
}

/** Join as a brand-new player; points start at the next race. */
export async function joinAsNewPlayer(
  db: Db,
  user: { id: string },
  token: string,
  rawName: string,
): Promise<Player> {
  const inv = await findUsableInvite(db, token);
  if (!inv) throw new LeagueError("This invite link isn't valid any more. Ask a member for a new one.");
  if (await getPlayerForUser(db, user.id)) throw new LeagueError("You're already in the league.");
  const name = rawName.trim();
  if (name.length < 2 || name.length > 40) throw new LeagueError("Pick a name between 2 and 40 characters.");
  const [taken] = await db
    .select({ id: players.id })
    .from(players)
    .where(sql`lower(${players.displayName}) = lower(${name})`)
    .limit(1);
  if (taken) throw new LeagueError("That name is taken. If it's you, choose \"I already play\" instead.");
  const [p] = await db
    .insert(players)
    .values({ displayName: name, userId: user.id, joinedAtRaceId: await nextRaceId(db) })
    .returning();
  await consumeInvite(db, inv, user.id);
  await logActivity(db, user.id, "joined", { playerId: p.id, inviteId: inv.id });
  return p;
}

/** "I already play": ask to be linked to an existing profile; a commissioner confirms. */
export async function requestClaim(db: Db, user: { id: string }, token: string, playerId: number) {
  const inv = await findUsableInvite(db, token);
  if (!inv) throw new LeagueError("This invite link isn't valid any more. Ask a member for a new one.");
  if (await getPlayerForUser(db, user.id)) throw new LeagueError("You're already in the league.");
  const [mine] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.claimRequestedBy, user.id))
    .limit(1);
  if (mine) throw new LeagueError("You already have a request waiting for a commissioner.");
  const res = await db
    .update(players)
    .set({ claimRequestedBy: user.id })
    .where(and(eq(players.id, playerId), isNull(players.userId), isNull(players.claimRequestedBy)))
    .returning({ id: players.id });
  if (res.length === 0) throw new LeagueError("That profile has already been claimed.");
  await consumeInvite(db, inv, user.id);
  await logActivity(db, user.id, "claim_requested", { playerId });
}

export async function pendingClaimForUser(db: Db, userId: string): Promise<Player | undefined> {
  const [p] = await db.select().from(players).where(eq(players.claimRequestedBy, userId)).limit(1);
  return p;
}

export async function resolveClaim(db: Db, adminUserId: string, playerId: number, approve: boolean) {
  await requireCommissioner(db, adminUserId);
  const [p] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!p?.claimRequestedBy) throw new LeagueError("There's no request on that profile.");
  if (approve) {
    if (await getPlayerForUser(db, p.claimRequestedBy)) {
      throw new LeagueError("That account is already linked to another player.");
    }
    await db
      .update(players)
      .set({ userId: p.claimRequestedBy, claimRequestedBy: null })
      .where(eq(players.id, playerId));
  } else {
    await db.update(players).set({ claimRequestedBy: null }).where(eq(players.id, playerId));
  }
  await logActivity(db, adminUserId, approve ? "claim_approved" : "claim_rejected", {
    playerId,
    userId: p.claimRequestedBy,
  });
}

/* ─────────────────────── Commissioner: players ─────────────────────── */

/** Add a profile with no account yet (e.g. the 2026 roster before people sign in). */
export async function addPlayer(db: Db, adminUserId: string, rawName: string): Promise<Player> {
  await requireCommissioner(db, adminUserId);
  const name = rawName.trim();
  if (name.length < 2 || name.length > 40) throw new LeagueError("Pick a name between 2 and 40 characters.");
  const [taken] = await db
    .select({ id: players.id })
    .from(players)
    .where(sql`lower(${players.displayName}) = lower(${name})`)
    .limit(1);
  if (taken) throw new LeagueError("That name is taken.");
  const [p] = await db.insert(players).values({ displayName: name }).returning();
  await logActivity(db, adminUserId, "player_added", { playerId: p.id, name });
  return p;
}

export async function renamePlayer(db: Db, adminUserId: string, playerId: number, rawName: string) {
  await requireCommissioner(db, adminUserId);
  const name = rawName.trim();
  if (name.length < 2 || name.length > 40) throw new LeagueError("Pick a name between 2 and 40 characters.");
  const [taken] = await db
    .select({ id: players.id })
    .from(players)
    .where(and(sql`lower(${players.displayName}) = lower(${name})`, ne(players.id, playerId)))
    .limit(1);
  if (taken) throw new LeagueError("That name is taken.");
  await db.update(players).set({ displayName: name }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "player_renamed", { playerId, name });
}

async function activeCommissionerCount(db: Db): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(players)
    .where(and(eq(players.role, "commissioner"), eq(players.active, true)));
  return n;
}

export async function setRole(
  db: Db,
  adminUserId: string,
  playerId: number,
  role: "player" | "commissioner",
) {
  await requireCommissioner(db, adminUserId);
  const [p] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!p) throw new LeagueError("No such player.");
  if (role === "commissioner" && !p.userId) {
    throw new LeagueError("Only players who have signed in can be commissioners.");
  }
  if (p.role === "commissioner" && role === "player" && (await activeCommissionerCount(db)) <= 1) {
    throw new LeagueError("The league needs at least one commissioner.");
  }
  await db.update(players).set({ role }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "role_changed", { playerId, role });
}

export async function setPlayerActive(db: Db, adminUserId: string, playerId: number, active: boolean) {
  await requireCommissioner(db, adminUserId);
  const [p] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!p) throw new LeagueError("No such player.");
  if (!active && p.role === "commissioner" && (await activeCommissionerCount(db)) <= 1) {
    throw new LeagueError("The league needs at least one commissioner.");
  }
  await db.update(players).set({ active }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, active ? "player_reactivated" : "player_deactivated", { playerId });
}

/** Commissioner: unlink an account from a profile (e.g. wrong person claimed it). */
export async function unlinkPlayer(db: Db, adminUserId: string, playerId: number) {
  await requireCommissioner(db, adminUserId);
  const [p] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!p) throw new LeagueError("No such player.");
  if (p.role === "commissioner") throw new LeagueError("Make them a regular player first.");
  await db.update(players).set({ userId: null }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "player_unlinked", { playerId, userId: p.userId });
}
