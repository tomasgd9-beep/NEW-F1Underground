// Membership rules: league codes, email invites, joining, claiming a 2026
// profile, roles. Every function takes the database as its first argument so
// tests can run it against PGlite and the app against Neon.
//
// The site hosts one league today (F1 Underground) but everything is scoped by
// league, so more leagues can be switched on later.
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activityLog, invites, leagues, picks, players, races, reminders, users } from "@/db/schema";

export class LeagueError extends Error {}

export type Player = typeof players.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type League = typeof leagues.$inferSelect;

export function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Six characters people can read out loud: no 0/O, 1/I/L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newLeagueCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function logActivity(
  db: Db,
  actor: string,
  action: string,
  detail?: Record<string, unknown>,
  opts: { leagueId?: number | null; result?: string } = {},
) {
  await db
    .insert(activityLog)
    .values({ actor, action, detail, leagueId: opts.leagueId ?? null, result: opts.result ?? "ok" });
}

/** The user's league membership (the first one; there's only one league today). */
export async function getPlayerForUser(db: Db, userId: string): Promise<Player | undefined> {
  const [p] = await db
    .select()
    .from(players)
    .where(eq(players.userId, userId))
    .orderBy(asc(players.id))
    .limit(1);
  return p;
}

export async function getLeague(db: Db, leagueId: number): Promise<League> {
  const [l] = await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  if (!l) throw new LeagueError("No such league.");
  return l;
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

/** A player in the commissioner's own league, or an error. */
async function playerInLeague(db: Db, playerId: number, leagueId: number): Promise<Player> {
  const [p] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.leagueId, leagueId)))
    .limit(1);
  if (!p) throw new LeagueError("No such player.");
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

async function nameTaken(db: Db, leagueId: number, name: string, exceptPlayerId?: number) {
  const [taken] = await db
    .select({ id: players.id })
    .from(players)
    .where(
      and(
        eq(players.leagueId, leagueId),
        sql`lower(${players.displayName}) = lower(${name})`,
        exceptPlayerId ? ne(players.id, exceptPlayerId) : undefined,
      ),
    )
    .limit(1);
  return !!taken;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** The one unlinked profile whose name is this name, or this name's first word ("Alonso" for "Alonso Pérez"). */
async function unlinkedProfileFor(db: Db, leagueId: number, name: string): Promise<Player | undefined> {
  const open = await db
    .select()
    .from(players)
    .where(and(eq(players.leagueId, leagueId), isNull(players.userId), isNull(players.claimRequestedBy)));
  const full = fold(name);
  const first = full.split(/\s+/)[0];
  const exact = open.filter((p) => fold(p.displayName) === full);
  if (exact.length === 1) return exact[0];
  const byFirst = open.filter((p) => fold(p.displayName) === first);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) throw new LeagueError("Pick a name between 2 and 40 characters.");
  return name;
}

async function uniqueName(db: Db, leagueId: number, base: string): Promise<string> {
  const clean = base.trim().slice(0, 40) || "Player";
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? clean : `${clean} ${i}`;
    if (!(await nameTaken(db, leagueId, name))) return name;
  }
  throw new LeagueError("Couldn't find a free name.");
}

/**
 * The league creator(s): emails listed in BOOTSTRAP_COMMISSIONER_EMAILS become
 * commissioners of the league on first sign-in (creating it if there is none).
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
  let [league] = await db.select().from(leagues).orderBy(asc(leagues.id)).limit(1);
  if (!league) {
    [league] = await db.insert(leagues).values({ name: "F1 Underground", code: newLeagueCode() }).returning();
  }
  const displayName = await uniqueName(db, league.id, user.name || email.split("@")[0]);
  const [p] = await db
    .insert(players)
    .values({ leagueId: league.id, displayName, userId: user.id, role: "commissioner" })
    .returning();
  await logActivity(db, user.id, "bootstrap_commissioner", { playerId: p.id }, { leagueId: league.id });
  return p;
}

/* ───────────────────────────── League code ───────────────────────────── */

/** Commissioner: a fresh code; the old one stops working. */
export async function regenerateCode(db: Db, userId: string): Promise<League> {
  const me = await requireCommissioner(db, userId);
  const [l] = await db
    .update(leagues)
    .set({ code: newLeagueCode(), codeActive: true })
    .where(eq(leagues.id, me.leagueId))
    .returning();
  await logActivity(db, userId, "league_code_changed", undefined, { leagueId: me.leagueId });
  return l;
}

/** Commissioner: pause or resume joining by code (email invites still work). */
export async function setCodeActive(db: Db, userId: string, active: boolean) {
  const me = await requireCommissioner(db, userId);
  await db.update(leagues).set({ codeActive: active }).where(eq(leagues.id, me.leagueId));
  await logActivity(db, userId, active ? "league_code_resumed" : "league_code_paused", undefined, {
    leagueId: me.leagueId,
  });
}

/* ───────────────────────────── Email invites ───────────────────────────── */

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Any member: invite someone by email. Returns the invite; the caller sends the email. */
export async function createEmailInvite(db: Db, userId: string, rawEmail: string): Promise<Invite> {
  const me = await requireActivePlayer(db, userId);
  const email = rawEmail.trim().toLowerCase();
  if (!emailPattern.test(email)) throw new LeagueError("That doesn't look like an email address.");
  const [member] = await db
    .select({ id: players.id })
    .from(players)
    .innerJoin(users, eq(users.id, players.userId))
    .where(and(eq(players.leagueId, me.leagueId), eq(users.email, email)))
    .limit(1);
  if (member) throw new LeagueError("That person is already in the league.");
  const [pending] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.leagueId, me.leagueId),
        eq(invites.kind, "email"),
        eq(invites.email, email),
        eq(invites.active, true),
        isNull(invites.usedAt),
      ),
    )
    .limit(1);
  if (pending) return pending;
  const [created] = await db
    .insert(invites)
    .values({ leagueId: me.leagueId, kind: "email", email, token: newToken(), invitedByUserId: userId })
    .returning();
  await logActivity(db, userId, "email_invite_created", { inviteId: created.id, email }, { leagueId: me.leagueId });
  return created;
}

export async function cancelInvite(db: Db, userId: string, inviteId: number) {
  const me = await requireCommissioner(db, userId);
  await db
    .update(invites)
    .set({ active: false })
    .where(and(eq(invites.id, inviteId), eq(invites.leagueId, me.leagueId)));
  await logActivity(db, userId, "invite_cancelled", { inviteId }, { leagueId: me.leagueId });
}

/* ───────────────────────────── Joining ───────────────────────────── */

export type JoinKey = { league: League; invite: Invite | null };

/** What a code or an invite link opens: the league code, or a one-time email invite. */
export async function resolveJoinKey(db: Db, raw: string): Promise<JoinKey | null> {
  const key = raw.trim();
  if (!key) return null;
  const [inv] = await db.select().from(invites).where(eq(invites.token, key)).limit(1);
  if (inv) {
    if (!inv.active || inv.kind !== "email" || inv.usedAt) return null;
    return { league: await getLeague(db, inv.leagueId), invite: inv };
  }
  const code = normaliseCode(key);
  if (!code) return null;
  const [l] = await db.select().from(leagues).where(eq(leagues.code, code)).limit(1);
  if (!l || !l.codeActive) return null;
  return { league: l, invite: null };
}

const badKey = "That code doesn't open a league. Check it with whoever shared it.";

async function consumeInvite(db: Db, inv: Invite | null, userId: string) {
  if (inv) await db.update(invites).set({ usedAt: new Date(), usedByUserId: userId }).where(eq(invites.id, inv.id));
}

async function alreadyIn(db: Db, leagueId: number, userId: string) {
  const [p] = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.leagueId, leagueId), eq(players.userId, userId)))
    .limit(1);
  return !!p;
}

/** 2026 profiles in a league that nobody has linked or claimed yet. */
export async function unclaimedPlayers(db: Db, leagueId: number): Promise<Player[]> {
  return db
    .select()
    .from(players)
    .where(
      and(
        eq(players.leagueId, leagueId),
        isNull(players.userId),
        isNull(players.claimRequestedBy),
        eq(players.active, true),
      ),
    )
    .orderBy(asc(players.displayName));
}

/** Join as a brand-new player; points start at the next race. */
export async function joinAsNewPlayer(db: Db, user: { id: string }, key: string, rawName: string): Promise<Player> {
  const jk = await resolveJoinKey(db, key);
  if (!jk) throw new LeagueError(badKey);
  if (await alreadyIn(db, jk.league.id, user.id)) throw new LeagueError("You're already in this league.");
  if (await pendingClaimForUser(db, user.id)) throw new LeagueError("You already have a request waiting for a commissioner.");
  const name = cleanName(rawName);

  // Someone who played on the spreadsheet already has a profile with their
  // first name (and their 2026 teams): joining under that name links it.
  const profile = await unlinkedProfileFor(db, jk.league.id, name);
  if (profile) {
    const rename = !(await nameTaken(db, jk.league.id, name, profile.id));
    const [p] = await db
      .update(players)
      .set({ userId: user.id, ...(rename ? { displayName: name } : {}) })
      .where(and(eq(players.id, profile.id), isNull(players.userId)))
      .returning();
    if (p) {
      await consumeInvite(db, jk.invite, user.id);
      await logActivity(db, user.id, "joined", { playerId: p.id, linked: true }, { leagueId: jk.league.id });
      return p;
    }
  }

  if (await nameTaken(db, jk.league.id, name)) {
    throw new LeagueError("Someone in the league already uses that name. Add a surname initial, e.g. \"Tomas G\".");
  }
  const [p] = await db
    .insert(players)
    .values({ leagueId: jk.league.id, displayName: name, userId: user.id, joinedAtRaceId: await nextRaceId(db) })
    .returning();
  await consumeInvite(db, jk.invite, user.id);
  await logActivity(db, user.id, "joined", { playerId: p.id }, { leagueId: jk.league.id });
  return p;
}

/** "I already play": ask to be linked to an existing profile; a commissioner confirms. */
export async function requestClaim(db: Db, user: { id: string }, key: string, playerId: number) {
  const jk = await resolveJoinKey(db, key);
  if (!jk) throw new LeagueError(badKey);
  if (await alreadyIn(db, jk.league.id, user.id)) throw new LeagueError("You're already in this league.");
  if (await pendingClaimForUser(db, user.id)) throw new LeagueError("You already have a request waiting for a commissioner.");
  const res = await db
    .update(players)
    .set({ claimRequestedBy: user.id })
    .where(
      and(
        eq(players.id, playerId),
        eq(players.leagueId, jk.league.id),
        isNull(players.userId),
        isNull(players.claimRequestedBy),
      ),
    )
    .returning({ id: players.id });
  if (res.length === 0) throw new LeagueError("That profile has already been claimed.");
  await consumeInvite(db, jk.invite, user.id);
  await logActivity(db, user.id, "claim_requested", { playerId }, { leagueId: jk.league.id });
}

export async function pendingClaimForUser(db: Db, userId: string): Promise<Player | undefined> {
  const [p] = await db.select().from(players).where(eq(players.claimRequestedBy, userId)).limit(1);
  return p;
}

/** A user can withdraw their own pending claim (e.g. picked the wrong name). */
export async function withdrawClaim(db: Db, userId: string) {
  const p = await pendingClaimForUser(db, userId);
  if (!p) return;
  await db.update(players).set({ claimRequestedBy: null }).where(eq(players.id, p.id));
  await logActivity(db, userId, "claim_withdrawn", { playerId: p.id }, { leagueId: p.leagueId });
}

export async function resolveClaim(db: Db, adminUserId: string, playerId: number, approve: boolean) {
  const me = await requireCommissioner(db, adminUserId);
  const p = await playerInLeague(db, playerId, me.leagueId);
  if (!p.claimRequestedBy) throw new LeagueError("There's no request on that profile.");
  if (approve) {
    if (await alreadyIn(db, me.leagueId, p.claimRequestedBy)) {
      throw new LeagueError("That account is already linked to another player.");
    }
    await db.update(players).set({ userId: p.claimRequestedBy, claimRequestedBy: null }).where(eq(players.id, playerId));
  } else {
    await db.update(players).set({ claimRequestedBy: null }).where(eq(players.id, playerId));
  }
  await logActivity(
    db,
    adminUserId,
    approve ? "claim_approved" : "claim_rejected",
    { playerId, userId: p.claimRequestedBy },
    { leagueId: me.leagueId },
  );
}

/* ─────────────────────── Commissioner: players ─────────────────────── */

/** Add a profile with no account yet (e.g. the 2026 roster before people sign in). */
export async function addPlayer(db: Db, adminUserId: string, rawName: string): Promise<Player> {
  const me = await requireCommissioner(db, adminUserId);
  const name = cleanName(rawName);
  if (await nameTaken(db, me.leagueId, name)) throw new LeagueError("That name is taken.");
  const [p] = await db.insert(players).values({ leagueId: me.leagueId, displayName: name }).returning();
  await logActivity(db, adminUserId, "player_added", { playerId: p.id, name }, { leagueId: me.leagueId });
  return p;
}

export async function renamePlayer(db: Db, adminUserId: string, playerId: number, rawName: string) {
  const me = await requireCommissioner(db, adminUserId);
  await playerInLeague(db, playerId, me.leagueId);
  const name = cleanName(rawName);
  if (await nameTaken(db, me.leagueId, name, playerId)) throw new LeagueError("That name is taken.");
  await db.update(players).set({ displayName: name }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "player_renamed", { playerId, name }, { leagueId: me.leagueId });
}

async function activeCommissionerCount(db: Db, leagueId: number): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(players)
    .where(and(eq(players.leagueId, leagueId), eq(players.role, "commissioner"), eq(players.active, true)));
  return n;
}

export async function setRole(db: Db, adminUserId: string, playerId: number, role: "player" | "commissioner") {
  const me = await requireCommissioner(db, adminUserId);
  const p = await playerInLeague(db, playerId, me.leagueId);
  if (role === "commissioner" && !p.userId) {
    throw new LeagueError("Only players who have signed in can be commissioners.");
  }
  if (p.role === "commissioner" && role === "player" && (await activeCommissionerCount(db, me.leagueId)) <= 1) {
    throw new LeagueError("The league needs at least one commissioner.");
  }
  await db.update(players).set({ role }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "role_changed", { playerId, role }, { leagueId: me.leagueId });
}

export async function setPlayerActive(db: Db, adminUserId: string, playerId: number, active: boolean) {
  const me = await requireCommissioner(db, adminUserId);
  const p = await playerInLeague(db, playerId, me.leagueId);
  if (!active && p.role === "commissioner" && (await activeCommissionerCount(db, me.leagueId)) <= 1) {
    throw new LeagueError("The league needs at least one commissioner.");
  }
  await db.update(players).set({ active }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, active ? "player_reactivated" : "player_deactivated", { playerId }, {
    leagueId: me.leagueId,
  });
}

/** Commissioner: unlink an account from a profile (e.g. wrong person claimed it). */
export async function unlinkPlayer(db: Db, adminUserId: string, playerId: number) {
  const me = await requireCommissioner(db, adminUserId);
  const p = await playerInLeague(db, playerId, me.leagueId);
  if (p.role === "commissioner") throw new LeagueError("Make them a regular player first.");
  await db.update(players).set({ userId: null }).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "player_unlinked", { playerId, userId: p.userId }, { leagueId: me.leagueId });
}

/** Commissioner: delete a placeholder profile (never signed in, no picks, no pending claim). */
/**
 * Two profiles that are the same person (e.g. "Gio" who joined, and "Gioacchino" from the
 * spreadsheet): the sign-in and any teams move onto `intoId`, which keeps its name and history,
 * and `fromId` is removed. Where both have a team for the same race, the locked race keeps
 * `intoId`'s team and an open race keeps `fromId`'s (the one the person is editing now).
 */
export async function mergePlayers(db: Db, adminUserId: string, fromId: number, intoId: number) {
  const me = await requireCommissioner(db, adminUserId);
  if (fromId === intoId) throw new LeagueError("Pick two different profiles.");
  const from = await playerInLeague(db, fromId, me.leagueId);
  const into = await playerInLeague(db, intoId, me.leagueId);
  if (from.userId && into.userId && from.userId !== into.userId) {
    throw new LeagueError("Both profiles have their own sign-in. Unlink one of them first.");
  }
  const fromPicks = await db.select().from(picks).where(eq(picks.playerId, fromId));
  for (const fp of fromPicks) {
    const [race] = await db.select({ lockedAt: races.lockedAt }).from(races).where(eq(races.id, fp.raceId));
    const [ip] = await db
      .select({ id: picks.id })
      .from(picks)
      .where(and(eq(picks.playerId, intoId), eq(picks.raceId, fp.raceId)));
    if (ip && race?.lockedAt) {
      await db.delete(picks).where(eq(picks.id, fp.id));
      continue;
    }
    if (ip) await db.delete(picks).where(eq(picks.id, ip.id));
    await db.update(picks).set({ playerId: intoId }).where(eq(picks.id, fp.id));
  }
  await db.delete(reminders).where(eq(reminders.playerId, fromId)); // reminder log only
  const userId = into.userId ?? from.userId;
  const role = from.role === "commissioner" || into.role === "commissioner" ? "commissioner" : "player";
  await db.update(players).set({ userId: null }).where(eq(players.id, fromId));
  await db.delete(players).where(eq(players.id, fromId));
  await db
    .update(players)
    .set({ userId, role, active: true, claimRequestedBy: null })
    .where(eq(players.id, intoId));
  await logActivity(
    db,
    adminUserId,
    "players_merged",
    { from: from.displayName, into: into.displayName, teamsMoved: fromPicks.length },
    { leagueId: me.leagueId },
  );
}

export async function deletePlaceholder(db: Db, adminUserId: string, playerId: number) {
  const me = await requireCommissioner(db, adminUserId);
  const p = await playerInLeague(db, playerId, me.leagueId);
  if (p.userId || p.claimRequestedBy) {
    throw new LeagueError("Only profiles nobody has signed in to can be deleted. Deactivate this one instead.");
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(picks)
    .where(eq(picks.playerId, playerId));
  if (n > 0) throw new LeagueError("This profile has teams saved, so it can't be deleted. Deactivate it instead.");
  await db.delete(players).where(eq(players.id, playerId));
  await logActivity(db, adminUserId, "player_deleted", { playerId, name: p.displayName }, { leagueId: me.leagueId });
}
