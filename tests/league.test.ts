import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { activityLog, leagues, players, races, seasons } from "@/db/schema";
import {
  addPlayer,
  createEmailInvite,
  ensureBootstrapCommissioner,
  getLeague,
  getPlayerForUser,
  joinAsNewPlayer,
  normaliseCode,
  pendingClaimForUser,
  regenerateCode,
  requestClaim,
  resolveClaim,
  resolveJoinKey,
  setCodeActive,
  setPlayerActive,
  setRole,
  unclaimedPlayers,
  withdrawClaim,
} from "@/lib/league";
import { makeUser, testDb } from "./helpers";

let db: Db;
let tomas: Awaited<ReturnType<typeof makeUser>>;
let code: string;
let leagueId: number;

beforeEach(async () => {
  db = await testDb();
  tomas = await makeUser(db, "Tomas@example.com", "Tomás");
  const me = await ensureBootstrapCommissioner(db, tomas, ["tomas@example.com"]);
  leagueId = me!.leagueId;
  code = (await getLeague(db, leagueId)).code;
});

describe("bootstrap", () => {
  it("creates the league and makes the listed email its commissioner, once", async () => {
    const p = await getPlayerForUser(db, tomas.id);
    expect(p?.role).toBe("commissioner");
    expect(p?.displayName).toBe("Tomás");
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await ensureBootstrapCommissioner(db, tomas, ["tomas@example.com"]);
    expect(await db.select().from(players)).toHaveLength(1);
    expect(await db.select().from(leagues)).toHaveLength(1);
  });

  it("ignores emails not on the list", async () => {
    const other = await makeUser(db, "x@example.com");
    expect(await ensureBootstrapCommissioner(db, other, ["tomas@example.com"])).toBeUndefined();
  });
});

describe("league code", () => {
  it("opens the league, ignoring case, spaces and dashes", async () => {
    expect(normaliseCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe(code);
    expect((await resolveJoinKey(db, code.toLowerCase()))?.league.id).toBe(leagueId);
    expect(await resolveJoinKey(db, "NOPE99")).toBeNull();
  });

  it("can be changed or paused by a commissioner", async () => {
    const l = await regenerateCode(db, tomas.id);
    expect(l.code).not.toBe(code);
    expect(await resolveJoinKey(db, code)).toBeNull();
    await setCodeActive(db, tomas.id, false);
    expect(await resolveJoinKey(db, l.code)).toBeNull();
    await setCodeActive(db, tomas.id, true);
    expect(await resolveJoinKey(db, l.code)).not.toBeNull();
  });

  it("can't be changed by a regular player", async () => {
    const u = await makeUser(db, "p@example.com");
    await joinAsNewPlayer(db, u, code, "Pablo");
    await expect(regenerateCode(db, u.id)).rejects.toThrow(/commissioners/);
  });

  it("lets several people join, starting at the next race", async () => {
    const [season] = await db.insert(seasons).values({ year: 2027 }).returning();
    const day = 864e5;
    await db.insert(races).values([
      { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australia", deadline: new Date(Date.now() - day) },
      { seasonId: season.id, round: 2, label: "R02 CHN", name: "China", deadline: new Date(Date.now() + day) },
    ]);
    const u1 = await makeUser(db, "a@example.com");
    const u2 = await makeUser(db, "b@example.com");
    const p1 = await joinAsNewPlayer(db, u1, code, "Ana");
    await joinAsNewPlayer(db, u2, code, "Beto");
    const [r2] = await db.select().from(races).where(eq(races.round, 2));
    expect(p1.joinedAtRaceId).toBe(r2.id);
    expect(p1.leagueId).toBe(leagueId);
    await expect(joinAsNewPlayer(db, u1, code, "Ana again")).rejects.toThrow(/already in this league/);
  });

  it("refuses a taken name, case-insensitively", async () => {
    const u = await makeUser(db, "c@example.com");
    await expect(joinAsNewPlayer(db, u, code, "tomás")).rejects.toThrow(/already uses/);
  });

  it("refuses a wrong code with a clear message", async () => {
    const u = await makeUser(db, "d@example.com");
    await expect(joinAsNewPlayer(db, u, "WRONG1", "Dani")).rejects.toThrow(/doesn't open a league/);
  });
});

describe("email invites", () => {
  it("work once and are reused while pending", async () => {
    const i1 = await createEmailInvite(db, tomas.id, " Friend@Example.com ");
    const i2 = await createEmailInvite(db, tomas.id, "friend@example.com");
    expect(i1.id).toBe(i2.id);
    expect(i1.email).toBe("friend@example.com");
    const friend = await makeUser(db, "friend@example.com");
    await joinAsNewPlayer(db, friend, i1.token, "Friend");
    expect(await resolveJoinKey(db, i1.token)).toBeNull();
    await expect(createEmailInvite(db, tomas.id, "friend@example.com")).rejects.toThrow(/already in the league/);
  });

  it("still work while joining by code is paused", async () => {
    await setCodeActive(db, tomas.id, false);
    const inv = await createEmailInvite(db, tomas.id, "g@example.com");
    const g = await makeUser(db, "g@example.com");
    await joinAsNewPlayer(db, g, inv.token, "Gabi");
    expect((await getPlayerForUser(db, g.id))?.displayName).toBe("Gabi");
  });

  it("rejects bad addresses", async () => {
    await expect(createEmailInvite(db, tomas.id, "not-an-email")).rejects.toThrow(/email/);
  });
});

describe("claiming a 2026 profile", () => {
  it("needs a commissioner to confirm", async () => {
    const jb = await addPlayer(db, tomas.id, "JB");
    const u = await makeUser(db, "jb@example.com");
    expect((await unclaimedPlayers(db, leagueId)).map((p) => p.displayName)).toEqual(["JB"]);
    await requestClaim(db, u, code, jb.id);
    expect(await unclaimedPlayers(db, leagueId)).toHaveLength(0);
    expect(await getPlayerForUser(db, u.id)).toBeUndefined();
    await resolveClaim(db, tomas.id, jb.id, true);
    expect((await getPlayerForUser(db, u.id))?.displayName).toBe("JB");
  });

  it("can be rejected or withdrawn, freeing the profile again", async () => {
    const jb = await addPlayer(db, tomas.id, "JB");
    const u = await makeUser(db, "imposter@example.com");
    await requestClaim(db, u, code, jb.id);
    await resolveClaim(db, tomas.id, jb.id, false);
    expect(await unclaimedPlayers(db, leagueId)).toHaveLength(1);
    await requestClaim(db, u, code, jb.id);
    await withdrawClaim(db, u.id);
    expect(await pendingClaimForUser(db, u.id)).toBeUndefined();
    expect(await unclaimedPlayers(db, leagueId)).toHaveLength(1);
  });

  it("can't claim a profile someone else is claiming, or two at once", async () => {
    const jb = await addPlayer(db, tomas.id, "JB");
    const iv = await addPlayer(db, tomas.id, "IV");
    const u1 = await makeUser(db, "1@example.com");
    await requestClaim(db, u1, code, jb.id);
    await expect(requestClaim(db, await makeUser(db, "2@example.com"), code, jb.id)).rejects.toThrow(/already been claimed/);
    await expect(requestClaim(db, u1, code, iv.id)).rejects.toThrow(/waiting/);
  });
});

describe("roles", () => {
  it("never leaves the league without a commissioner", async () => {
    const me = await getPlayerForUser(db, tomas.id);
    await expect(setRole(db, tomas.id, me!.id, "player")).rejects.toThrow(/at least one/);
    await expect(setPlayerActive(db, tomas.id, me!.id, false)).rejects.toThrow(/at least one/);
  });

  it("only lets commissioners manage players", async () => {
    const u = await makeUser(db, "p@example.com");
    const p = await joinAsNewPlayer(db, u, code, "Pablo");
    await expect(addPlayer(db, u.id, "Someone")).rejects.toThrow(/commissioners/);
    await setRole(db, tomas.id, p.id, "commissioner");
    const me = await getPlayerForUser(db, tomas.id);
    await setRole(db, tomas.id, me!.id, "player");
    expect((await getPlayerForUser(db, tomas.id))?.role).toBe("player");
  });

  it("can't touch players in another league", async () => {
    const [other] = await db.insert(leagues).values({ name: "Other", code: "OTHER2" }).returning();
    const [stranger] = await db.insert(players).values({ leagueId: other.id, displayName: "Stranger" }).returning();
    await expect(setPlayerActive(db, tomas.id, stranger.id, false)).rejects.toThrow(/No such player/);
  });

  it("logs admin changes against the league", async () => {
    await addPlayer(db, tomas.id, "JB");
    const log = await db.select().from(activityLog).where(eq(activityLog.action, "player_added"));
    expect(log[0].leagueId).toBe(leagueId);
  });
});

describe("placeholder profiles", () => {
  it("can be deleted only while nobody has signed in to them", async () => {
    const t = await addPlayer(db, tomas.id, "Tomas");
    const { deletePlaceholder } = await import("@/lib/league");
    await deletePlaceholder(db, tomas.id, t.id);
    expect(await unclaimedPlayers(db, leagueId)).toHaveLength(0);
    const me = await getPlayerForUser(db, tomas.id);
    await expect(deletePlaceholder(db, tomas.id, me!.id)).rejects.toThrow(/Deactivate/);
  });
});
