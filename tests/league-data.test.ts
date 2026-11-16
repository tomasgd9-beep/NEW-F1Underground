import { describe, expect, it } from "vitest";
import brazil from "./fixtures/fft-brazil.json";
import type { FftAsset, FftLive } from "@/lib/fft";
import { ensureBootstrapCommissioner, getLeague, joinAsNewPlayer } from "@/lib/league";
import { loadLeague } from "@/lib/league-data";
import { importPrices, lockRace, syncFromFft } from "@/lib/sync";
import { currentRace, savePicks, teamAssets } from "@/lib/team";
import { makeUser, testDb } from "./helpers";

function fixture(): FftLive {
  const live = structuredClone(brazil) as unknown as FftLive;
  const bor = live.drivers.find((d) => d.id === "AUD_BOR")!;
  for (const [id, abbreviation, constructorId] of [["AUD_HUL", "HUL", "AUD"], ["ALP_GAS", "GAS", "ALP"], ["ALP_COL", "COL", "ALP"]]) {
    live.drivers.push({ ...(structuredClone(bor) as FftAsset), id, abbreviation, constructorId });
  }
  live.constructors.push({ ...live.constructors[0], id: "AUD", abbreviation: "AUD" });
  live.constructors.push({ ...live.constructors[0], id: "VRB", abbreviation: "VRB" });
  return live;
}

describe("league data", () => {
  it("never includes picks before the deadline, only who has submitted", async () => {
    const db = await testDb();
    const t = await makeUser(db, "t@example.com", "Tomas");
    const me = await ensureBootstrapCommissioner(db, t, ["t@example.com"]);
    const code = (await getLeague(db, me!.leagueId)).code;
    const ana = await makeUser(db, "a@example.com");
    const anaP = await joinAsNewPlayer(db, ana, code, "Ana");

    await syncFromFft(db, fixture());
    const vegas = (await currentRace(db))!;
    await importPrices(db, vegas, "VER 28.8\nANT 27.5\nLAW 11.1\nBOR 5.8\nHUL 7.8\nGAS 9\nCOL 7.6\nMER 34\nAUD 11.6");
    const ids = Object.fromEntries((await teamAssets(db, vegas)).map((a) => [a.ticker, a.id]));
    await savePicks(db, ana.id, vegas.id, { double: ids.BOR, d1: ids.ANT }, new Date("2026-11-20T00:00:00Z"));

    const before = (await loadLeague(db, me!.leagueId, me!.id))!;
    expect(before.submitted[vegas.id]).toEqual([anaP.id]);
    expect(before.teams[vegas.id]).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain(`"assetId":"${ids.ANT}"`);

    await lockRace(db, vegas, null, { now: new Date("2026-11-21T05:00:00Z") });
    const after = (await loadLeague(db, me!.leagueId, me!.id))!;
    expect(after.teams[vegas.id][anaP.id].picks.map((p) => p.assetId)).toContain(ids.ANT);
    expect(after.teams[vegas.id][me!.id].origin).toBe("random");
    expect(after.races.map((r) => r.label)).toEqual(["R20 BRA", "R21 VEG"]);
    expect(after.stats[after.assets[ids.VER].statKey].season).toBe(65);
  });
});
