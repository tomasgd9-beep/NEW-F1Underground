import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { players, races, seasons, activityLog } from "@/db/schema";
import {
  addPlayer,
  createEmailInvite,
  ensureBootstrapCommissioner,
  findUsableInvite,
  getOrCreateJoinLink,
  getPlayerForUser,
  joinAsNewPlayer,
  requestClaim,
  resetJoinLink,
  resolveClaim,
  setPlayerActive,
  setRole,
  unclaimedPlayers,
} from "@/lib/league";
import { makeUser, testDb } from "./helpers";

let db: Db;
let tomas: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  db = await testDb();
  tomas = await makeUser(db, "Tomas@example.com", "Tomás");
  await ensureBootstrapCommissioner(db, tomas, ["tomas@example.com"]);
});

describe("bootstrap", () => {
  it("makes the listed email a commissioner, once", async () => {
    const p = await getPlayerForUser(db, tomas.id);
    expect(p?.role).toBe("commissioner");
    expect(p?.displayName).toBe("Tomás");
    await ensureBootstrapCommissioner(db, tomas, ["tomas@example.com"]);
    expect(await db.select().from(players)).toHaveLength(1);
  });

  it("ignores emails not on the list", async () => {
    const other = await makeUser(db, "x@example.com");
    expect(await ensureBootstrapCommissioner(db, other, ["tomas@example.com"])).toBeUndefined();
  });
});

describe("join link", () => {
  it("is shared, reused, and can be reset by a commissioner", async () => {
    const a = await getOrCreateJoinLink(db, tomas.id);
    const b = await getOrCreateJoinLink(db, tomas.id);
    expect(a.token).toBe(b.token);
    const c = await resetJoinLink(db, tomas.id, true);
    expect(c?.token).not.toBe(a.token);
    expect(await findUsableInvite(db, a.token)).toBeNull();
    expect(await findUsableInvite(db, c!.token)).not.toBeNull();
  });

  it("can't be made by someone outside the league", async () => {
    const stranger = await makeUser(db, "s@example.com");
    await expect(getOrCreateJoinLink(db, stranger.id)).rejects.toThrow(/league members/);
  });

  it("lets several people join, starting at the next race", async () => {
    const [season] = await db.insert(seasons).values({ year: 2027 }).returning();
    const past = new Date(Date.now() - 864e5);
    const soon = new Date(Date.now() + 864e5);
    const later = new Date(Date.now() + 8 * 864e5);
    await db.insert(races).values([
      { seasonId: season.id, round: 1, label: "R01 AUS", name: "Australia", deadline: past },
      { seasonId: season.id, round: 2, label: "R02 CHN", name: "China", deadline: soon },
      { seasonId: season.id, round: 3, label: "R03 JPN", name: "Japan", deadline: later },
    ]);
    const link = await getOrCreateJoinLink(db, tomas.id);
    const u1 = await makeUser(db, "a@example.com");
    const u2 = await makeUser(db, "b@example.com");
    const p1 = await joinAsNewPlayer(db, u1, link.token, "Ana");
    await joinAsNewPlayer(db, u2, link.token, "Beto");
    const [r2] = await db.select().from(races).where(eq(races.round, 2));
    expect(p1.joinedAtRaceId).toBe(r2.id);
    expect(p1.role).toBe("player");
    await expect(joinAsNewPlayer(db, u1, link.token, "Ana again")).rejects.toThrow(/already/);
  });

  it("refuses a taken name, case-insensitively", async () => {
    const link = await getOrCreateJoinLink(db, tomas.id);
    const u = await makeUser(db, "c@example.com");
    await expect(joinAsNewPlayer(db, u, link.token, "tomás")).rejects.toThrow(/taken/);
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
    expect(await findUsableInvite(db, i1.token)).toBeNull();
    await expect(createEmailInvite(db, tomas.id, "friend@example.com")).rejects.toThrow(/already in the league/);
  });

  it("rejects bad addresses", async () => {
    await expect(createEmailInvite(db, tomas.id, "not-an-email")).rejects.toThrow(/email/);
  });
});

describe("claiming a 2026 profile", () => {
  it("needs a commissioner to confirm", async () => {
    const jb = await addPlayer(db, tomas.id, "JB");
    const link = await getOrCreateJoinLink(db, tomas.id);
    const u = await makeUser(db, "jb@example.com");
    expect((await unclaimedPlayers(db)).map((p) => p.displayName)).toEqual(["JB"]);
    await requestClaim(db, u, link.token, jb.id);
    expect(await unclaimedPlayers(db)).toHaveLength(0);
    expect(await getPlayerForUser(db, u.id)).toBeUndefined();
    await resolveClaim(db, tomas.id, jb.id, true);
    expect((await getPlayerForUser(db, u.id))?.displayName).toBe("JB");
  });

  it("can be rejected, freeing the profile again", async () => {
    const jb = await addPlayer(db, tomas.id, "JB");
    const link = await getOrCreateJoinLink(db, tomas.id);
    const u = await makeUser(db, "imposter@example.com");
    await requestClaim(db, u, link.token, jb.id);
    await resolveClaim(db, tomas.id, jb.id, false);
    expect(await unclaimedPlayers(db)).toHaveLength(1);
  });

  it("can't claim a profile someone else is claiming", async () => {
    const jb = await addPlayer(db, tomas.id, "JB");
    const link = await getOrCreateJoinLink(db, tomas.id);
    await requestClaim(db, await makeUser(db, "1@example.com"), link.token, jb.id);
    await expect(requestClaim(db, await makeUser(db, "2@example.com"), link.token, jb.id)).rejects.toThrow(
      /already been claimed/,
    );
  });
});

describe("roles", () => {
  it("never leaves the league without a commissioner", async () => {
    const me = await getPlayerForUser(db, tomas.id);
    await expect(setRole(db, tomas.id, me!.id, "player")).rejects.toThrow(/at least one/);
    await expect(setPlayerActive(db, tomas.id, me!.id, false)).rejects.toThrow(/at least one/);
  });

  it("only lets commissioners manage players", async () => {
    const link = await getOrCreateJoinLink(db, tomas.id);
    const u = await makeUser(db, "p@example.com");
    const p = await joinAsNewPlayer(db, u, link.token, "Pablo");
    await expect(addPlayer(db, u.id, "Someone")).rejects.toThrow(/commissioners/);
    await setRole(db, tomas.id, p.id, "commissioner");
    const me = await getPlayerForUser(db, tomas.id);
    await setRole(db, tomas.id, me!.id, "player"); // now allowed: Pablo is a commissioner
    expect((await getPlayerForUser(db, tomas.id))?.role).toBe("player");
  });

  it("logs admin changes", async () => {
    await addPlayer(db, tomas.id, "JB");
    const log = await db.select().from(activityLog);
    expect(log.map((l) => l.action)).toContain("player_added");
  });
});
