import { describe, expect, it } from "vitest";
import brazil from "./fixtures/fft-brazil.json";
import {
  breakdown,
  deadlineOf,
  parseAnalystSims,
  parseLive,
  raceLabel,
  resultsState,
  sessionsStarted,
  type FftAsset,
  type FftLive,
} from "@/lib/fft";

const live = brazil as unknown as FftLive;
const find = (id: string): FftAsset => [...live.drivers, ...live.constructors].find((a) => a.id === id)!;

/** The page embeds the data as escaped JSON inside a script string. */
function fakePage(data: FftLive) {
  const body = JSON.stringify({
    initialDrivers: data.drivers,
    initialConstructors: data.constructors,
    initialRace: data.race,
  }).replace(/"/g, '\\"');
  return `<html><script>self.__next_f.push([1,"${body}"])</script></html>`;
}

describe("parsing the live page", () => {
  it("finds drivers, constructors and the race", () => {
    const p = parseLive(fakePage(live));
    expect(p.drivers).toHaveLength(6);
    expect(p.constructors).toHaveLength(3);
    expect(p.race.id).toBe("2026_20");
    expect(p.race.nextRace?.name).toBe("Las Vegas Grand Prix");
  });

  it("fails loudly when the layout changes", () => {
    expect(() => parseLive("<html>nothing</html>")).toThrow(/initialDrivers not found/);
  });
});

describe("scoring breakdown (Brazil 2026, checked against f1fantasytools)", () => {
  const started = sessionsStarted(live.race);

  it("VER: 65 with DotD", () => {
    const b = breakdown(find("RED_VER"), started);
    expect(b.total).toBe(65);
    expect(b.parts.R).toEqual({ pos: 18, gained: 19, overtakes: 18, fastestLap: 0, dotdPit: 10, total: 65 });
    expect(b.parts.Q?.total).toBe(0);
    expect(b.parts.S).toBeUndefined(); // no sprint that weekend
  });

  it("ANT: positions lost count negative", () => {
    const b = breakdown(find("MER_ANT"), started);
    expect(b.parts.R).toMatchObject({ pos: 10, gained: -3, fastestLap: 10, total: 18 });
    expect(b.total).toBe(26);
  });

  it("not classified goes into position points", () => {
    const b = breakdown(find("HAA_OCO"), started);
    expect(b.parts.R?.pos).toBe(-20);
    expect(b.parts.Q?.pos).toBe(-5);
    expect(b.total).toBe(-25);
  });

  it("constructors: Q2/Q3 bonus and pit stops", () => {
    const mer = breakdown(find("MER"), started);
    expect(mer.parts.Q).toEqual({ pos: 17, team: 10, total: 27 });
    expect(mer.parts.R?.dotdPit).toBe(5);
    expect(mer.total).toBe(72);
    expect(breakdown(find("RED"), started).total).toBe(90);
    expect(breakdown(find("ALP"), started).parts.Q).toEqual({ pos: 0, team: -1, total: -1 });
  });

  it("leaves sessions that haven't started empty", () => {
    expect(breakdown(find("RED_VER"), { S: false, Q: false, R: false }).total).toBeNull();
  });
});

describe("race info", () => {
  it("deadline is qualifying on a normal weekend, sprint on a sprint weekend", () => {
    const vegas = live.race.nextRace!;
    expect(deadlineOf(vegas)?.when.toISOString()).toBe("2026-11-21T04:00:00.000Z");
    expect(deadlineOf(vegas)?.session).toBe("Qualifying");
    const sprint = {
      ...vegas,
      sprint: true,
      start_times: {
        sprint_qualifying: "2026-05-02T20:30:00Z",
        sprint: "2026-05-03T16:00:00Z",
        qualifying: "2026-05-03T20:00:00Z",
        race: "2026-05-04T20:00:00Z",
      },
    };
    expect(deadlineOf(sprint)?.when.toISOString()).toBe("2026-05-03T16:00:00.000Z");
  });

  it("results state and labels", () => {
    expect(resultsState(live.race)).toBe("final");
    expect(resultsState(live.race.nextRace!)).toBe("none");
    expect(raceLabel(live.race.nextRace!)).toBe("R21 VEG");
    expect(raceLabel(live.race)).toBe("R20 BRA");
  });
});

describe("analyst simulation", () => {
  it("takes the first preset for the round", () => {
    const sims = [
      { name: "Las Vegas. Early.", raceweek: 21, drivers: { pts: { MER_ANT: 30.35 } }, constructors: { pts: { MER: 71.05 } } },
      { name: "Las Vegas. Early. MCL", raceweek: 21, drivers: { pts: { MER_ANT: 1 } } },
    ];
    const page = `x "analystSims":${JSON.stringify(sims).replace(/"/g, '\\"')} y`;
    expect(parseAnalystSims(page, 21)).toEqual({ name: "Las Vegas. Early.", xp: { MER_ANT: 30.35, MER: 71.05 } });
    expect(parseAnalystSims(page, 22)).toBeNull();
  });
});
