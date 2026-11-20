import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { picks, players, races, seasons } from "@/db/schema";
import { ensureBootstrapCommissioner, getLeague, joinAsNewPlayer } from "@/lib/league";
import { makeUser, testDb } from "./helpers";

process.env.EMAIL_SERVER = "smtp://test"; // sendMail is mocked below
const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/mail", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail")>()),
  sendMail: async (to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
  },
}));
const { alertCommissioners, sendDeadlineReminders, sendLockNotices, sendRaceSummaries } = await import("@/lib/notify");

let db: Db;
let seasonId: number;
const now = new Date("2026-11-20T04:00:00Z");

beforeEach(async () => {
  sent.length = 0;
  db = await testDb();
  const t = await makeUser(db, "t@example.com", "Tomas");
  const me = await ensureBootstrapCommissioner(db, t, ["t@example.com"]);
  const code = (await getLeague(db, me!.leagueId)).code;
  await joinAsNewPlayer(db, await makeUser(db, "a@example.com"), code, "Ana");
  await db.insert(players).values({ leagueId: me!.leagueId, displayName: "Paolo" }); // no account: no email
  [{ id: seasonId }] = await db.insert(seasons).values({ year: 2026, status: "active" }).returning();
});

describe("deadline reminders", () => {
  it("goes to every signed-in player once, only inside the last 24 hours", async () => {
    const [race] = await db
      .insert(races)
      .values({ seasonId, round: 21, label: "R23 VEG", name: "Las Vegas Grand Prix", deadline: new Date("2026-11-21T04:00:00Z") })
      .returning();
    expect(await sendDeadlineReminders(db, new Date("2026-11-19T03:00:00Z"))).toBe(0); // 25 h before
    expect(await sendDeadlineReminders(db, now)).toBe(2);
    expect(sent.map((m) => m.to).sort()).toEqual(["a@example.com", "t@example.com"]);
    expect(sent[0].subject).toContain("R23 VEG");
    expect(sent[0].text).toContain("haven't saved a team");
    // Only the commissioner gets the message for the league chat.
    const boss = sent.find((m) => m.to === "t@example.com")!;
    const ana = sent.find((m) => m.to === "a@example.com")!;
    expect(boss.text).toContain("For the league WhatsApp");
    expect(boss.text).toContain("0 of 3 teams saved");
    expect(boss.text).toContain("Still to save: Ana, Paolo, Tomas");
    expect(boss.text).toContain("https://wa.me/?text=");
    expect(ana.text).not.toContain("WhatsApp");
    expect(await sendDeadlineReminders(db, now)).toBe(0); // already sent
    await db.update(races).set({ lockedAt: now }).where(eq(races.id, race.id));
  });
});

describe("race summaries", () => {
  it("are sent once for a race that just turned final, never for old imported races", async () => {
    const lockedAt = new Date("2026-11-08T17:00:00Z");
    await db.insert(races).values({
      seasonId,
      round: 20,
      label: "R22 BRA",
      name: "São Paulo Grand Prix",
      deadline: lockedAt,
      lockedAt,
      results: "final",
    });
    expect(await sendRaceSummaries(db, now)).toBe(0); // 12 days old
    expect(await sendRaceSummaries(db, new Date("2026-11-09T12:00:00Z"))).toBe(2);
    expect(sent[0].subject).toContain("R22 BRA");
    expect(await sendRaceSummaries(db, new Date("2026-11-09T13:00:00Z"))).toBe(0);
  });
});

describe("lock notices", () => {
  it("email commissioners the league message once, only for a race that just locked", async () => {
    const [race] = await db
      .insert(races)
      .values({ seasonId, round: 21, label: "R23 VEG", name: "Las Vegas Grand Prix", deadline: new Date("2026-11-21T04:00:00Z") })
      .returning();
    const at = new Date("2026-11-21T04:05:00Z");
    expect(await sendLockNotices(db, at)).toBe(0); // not locked yet
    const ps = await db.select().from(players);
    const id = (n: string) => ps.find((p) => p.displayName === n)!.id;
    await db.insert(picks).values([
      { playerId: id("Tomas"), raceId: race.id, origin: "manual" },
      { playerId: id("Ana"), raceId: race.id, origin: "auto_filled" },
      { playerId: id("Paolo"), raceId: race.id, origin: "random" },
    ]);
    await db.update(races).set({ lockedAt: at }).where(eq(races.id, race.id));
    expect(await sendLockNotices(db, at)).toBe(1);
    expect(sent[0].to).toBe("t@example.com");
    expect(sent[0].subject).toBe("R23 VEG teams locked");
    expect(sent[0].text).toContain("1 own team");
    expect(sent[0].text).toContain("Auto-filled empty slots: Ana");
    expect(sent[0].text).toContain("Random team: Paolo");
    expect(await sendLockNotices(db, new Date(at.getTime() + 300_000))).toBe(0); // once
    expect(await sendLockNotices(db, new Date(at.getTime() + 3 * 24 * 3600_000))).toBe(0);
  });
});

describe("job failure alert", () => {
  it("emails commissioners at most every 12 hours", async () => {
    const t = new Date();
    expect(await alertCommissioners(db, "boom", t)).toBe(1);
    expect(sent[0].to).toBe("t@example.com");
    expect(await alertCommissioners(db, "boom again", new Date(t.getTime() + 3600_000))).toBe(0);
    expect(await alertCommissioners(db, "still broken", new Date(t.getTime() + 13 * 3600_000))).toBe(1);
  });
});

describe("reminder wording", () => {
  it("covers no team, empty slots, over budget and complete", async () => {
    const { statusLines } = await import("@/lib/notify");
    const base = { saved: true, empty: [], price: 98.56, penalty: 0, budget: 100 };
    expect(statusLines({ ...base, saved: false, empty: ["D1 (×2)", "D2", "D3", "D4", "D5", "C"] })[0]).toMatch(/random team/);
    expect(statusLines({ ...base, empty: ["D3", "C"] })[0]).toMatch(/2 empty slots \(D3, C\).*filled automatically/);
    expect(statusLines({ ...base, price: 101.3, penalty: -20 })[0]).toMatch(/1\.30 over the 100 budget: that's −20 points/);
    expect(statusLines(base)[0]).toMatch(/complete \(98\.56 \/ 100\)/);
    expect(statusLines({ ...base, empty: ["D5"], price: 100.4, penalty: -10 })).toHaveLength(2);
  });
});
