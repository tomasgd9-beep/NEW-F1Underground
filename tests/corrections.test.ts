import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPoints, constructors, people, races, seasons, stints } from "@/db/schema";
import { clearPointsCorrection, setPoints, torontoToUtc, updateRace, utcToTorontoInput } from "@/lib/corrections";
import { ensureBootstrapCommissioner } from "@/lib/league";
import { currentRace } from "@/lib/team";
import { makeUser, testDb } from "./helpers";

let db: Db;
let uid: string;
let seasonId: number;

beforeEach(async () => {
  db = await testDb();
  const u = await makeUser(db, "t@example.com", "Tomas");
  await ensureBootstrapCommissioner(db, u, ["t@example.com"]);
  uid = u.id;
  [{ id: seasonId }] = await db.insert(seasons).values({ year: 2026, status: "active" }).returning();
});

describe("Toronto times", () => {
  it("reads typed times as Toronto time, winter and summer", () => {
    expect(torontoToUtc("2026-11-20T23:00").toISOString()).toBe("2026-11-21T04:00:00.000Z");
    expect(torontoToUtc("2026-07-04T10:00").toISOString()).toBe("2026-07-04T14:00:00.000Z");
    expect(utcToTorontoInput(new Date("2026-11-21T04:00:00Z"))).toBe("2026-11-20T23:00");
  });
});

describe("race status and deadline", () => {
  it("a typed deadline sticks; cancelling skips the race", async () => {
    const [veg] = await db
      .insert(races)
      .values({ seasonId, round: 21, label: "R23 VEG", name: "Vegas", deadline: new Date("2026-11-21T04:00:00Z") })
      .returning();
    await db.insert(races).values({ seasonId, round: 22, label: "R24 QAT", name: "Qatar", deadline: new Date("2026-11-28T14:00:00Z") });
    await updateRace(db, uid, veg.id, { status: "delayed", deadline: torontoToUtc("2026-11-21T23:00") });
    const [after] = await db.select().from(races).where(eq(races.id, veg.id));
    expect(after.deadlineManual).toBe(true);
    expect(after.status).toBe("delayed");
    await updateRace(db, uid, veg.id, { status: "cancelled", deadline: "auto" });
    expect((await currentRace(db))!.label).toBe("R24 QAT");
  });
});

describe("points corrections", () => {
  it("are saved as manual and can be handed back to the sync", async () => {
    const [r] = await db.insert(races).values({ seasonId, round: 21, label: "R23 VEG", name: "Vegas", isSprint: false }).returning();
    const [c] = await db.insert(constructors).values({ ticker: "RED", name: "Red Bull" }).returning();
    const [p] = await db.insert(people).values({ ticker: "VER", fullName: "Max" }).returning();
    const [s] = await db.insert(stints).values({ personId: p.id, constructorId: c.id }).returning();
    await setPoints(db, uid, r.id, `s${s.id}`, { S: null, Q: 10, R: 25 });
    const [row] = await db.select().from(assetPoints).where(eq(assetPoints.raceId, r.id));
    expect(Number(row.total)).toBe(35);
    expect(row.manual).toBe(true);
    await clearPointsCorrection(db, uid, r.id, `s${s.id}`);
    const [again] = await db.select().from(assetPoints).where(eq(assetPoints.raceId, r.id));
    expect(again.manual).toBe(false);
  });
});
