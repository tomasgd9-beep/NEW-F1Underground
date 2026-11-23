import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPoints, constructors, picks, players, races, recaps, seasons } from "@/db/schema";
import { ensureBootstrapCommissioner, getLeague, joinAsNewPlayer } from "@/lib/league";
import { makeUser, testDb } from "./helpers";

process.env.EMAIL_SERVER = "smtp://test";
const sent: { to: string; subject: string; text: string; attachments: number }[] = [];
vi.mock("@/lib/mail", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail")>()),
  sendMail: async (to: string, subject: string, text: string, _h?: string, extras?: { attachments?: unknown[] }) => {
    sent.push({ to, subject, text, attachments: extras?.attachments?.length ?? 0 });
  },
}));
const { sendAutoRecaps } = await import("@/lib/recap-email");

let db: Db;
let leagueId: number;
const now = new Date("2026-11-23T16:00:00Z");

beforeEach(async () => {
  sent.length = 0;
  db = await testDb();
  const t = await makeUser(db, "t@example.com", "Tomas");
  const me = await ensureBootstrapCommissioner(db, t, ["t@example.com"]);
  leagueId = me!.leagueId;
  await joinAsNewPlayer(db, await makeUser(db, "a@example.com"), (await getLeague(db, leagueId)).code, "Ana");
});

async function finalRace(deadline: Date) {
  const [{ id: seasonId }] = await db.insert(seasons).values({ year: 2026, status: "active" }).returning();
  const [race] = await db
    .insert(races)
    .values({ seasonId, round: 22, label: "R23 VEG", name: "Las Vegas Grand Prix", deadline, lockedAt: deadline, results: "final" })
    .returning();
  const [mcl, mer] = await db
    .insert(constructors)
    .values([
      { ticker: "MCL", name: "McLaren" },
      { ticker: "MER", name: "Mercedes" },
    ])
    .returning();
  await db.insert(assetPoints).values([
    { raceId: race.id, constructorId: mcl.id, total: "113", isFinal: true },
    { raceId: race.id, constructorId: mer.id, total: "78", isFinal: true },
  ]);
  const ps = await db.select().from(players);
  const id = (n: string) => ps.find((p) => p.displayName === n)!.id;
  await db.insert(picks).values([
    { playerId: id("Ana"), raceId: race.id, constructorId: mcl.id, penalty: 0 },
    { playerId: id("Tomas"), raceId: race.id, constructorId: mer.id, penalty: 0 },
  ]);
  return race;
}

describe("automatic recaps", () => {
  it("go to everyone once, as soon as the race is final", async () => {
    const race = await finalRace(new Date("2026-11-22T04:00:00Z"));
    expect(await sendAutoRecaps(db, now)).toBe(2);
    expect(sent.map((m) => m.to).sort()).toEqual(["a@example.com", "t@example.com"]);
    const ana = sent.find((m) => m.to === "a@example.com")!;
    expect(ana.subject).toBe("R23 VEG recap: Ana wins with 113");
    expect(ana.text).toContain("You scored 113 (1st of 2 this race).");
    expect(ana.text).toContain("/unsubscribe?t=");
    expect(await sendAutoRecaps(db, new Date(now.getTime() + 300_000))).toBe(0); // once
    const [row] = await db.select().from(recaps).where(eq(recaps.raceId, race.id));
    expect(row.sentCount).toBe(2);
  });

  it("skip old races and races marked skipAuto", async () => {
    const race = await finalRace(new Date("2026-11-10T04:00:00Z"));
    expect(await sendAutoRecaps(db, now)).toBe(0); // 13 days old
    await db.update(races).set({ deadline: new Date("2026-11-22T04:00:00Z") }).where(eq(races.id, race.id));
    await db.insert(recaps).values({ leagueId, raceId: race.id, skipAuto: true });
    expect(await sendAutoRecaps(db, now)).toBe(0);
  });
});
