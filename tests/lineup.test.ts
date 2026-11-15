import { describe, expect, it } from "vitest";
import { budgetPenalty, lineupIssues, slotFor, teamPrice, type LineupAsset, type Picks } from "@/lib/lineup";

const assets: LineupAsset[] = [
  { id: "s1", kind: "driver", price: 45.91 },
  { id: "s2", kind: "driver", price: 19.99 },
  { id: "s3", kind: "driver", price: 20 },
  { id: "s4", kind: "driver", price: 7.35 },
  { id: "s5", kind: "driver", price: 1.22 },
  { id: "c1", kind: "constructor", price: 27.85 },
];
const byId = new Map(assets.map((a) => [a.id, a]));

describe("budget penalty", () => {
  it("matches the sheet: −10 per whole or partial unit over 100", () => {
    expect(budgetPenalty(100)).toBe(0);
    expect(budgetPenalty(99.99)).toBe(0);
    expect(budgetPenalty(100.3)).toBe(-10);
    expect(budgetPenalty(101)).toBe(-10);
    expect(budgetPenalty(101.5)).toBe(-20);
  });
});

describe("team price", () => {
  it("adds the picked assets without float drift", () => {
    const picks: Picks = { double: "s2", d1: "s1", d2: "s4", d3: "s5", team: "c1" };
    expect(teamPrice(picks, byId)).toBe(102.32);
  });
});

describe("lineup issues", () => {
  it("allows a partial team", () => {
    expect(lineupIssues({ d1: "s1" }, byId)).toEqual([]);
  });
  it("blocks duplicates", () => {
    expect(lineupIssues({ d1: "s1", d2: "s1" }, byId).map((i) => i.code)).toEqual(["duplicate"]);
  });
  it("caps the ×2 driver strictly under 20", () => {
    expect(lineupIssues({ double: "s2" }, byId)).toEqual([]);
    expect(lineupIssues({ double: "s3" }, byId).map((i) => i.code)).toEqual(["double_price_cap"]);
  });
  it("keeps drivers and constructors in their own slots", () => {
    expect(lineupIssues({ d1: "c1" }, byId).map((i) => i.code)).toEqual(["wrong_kind"]);
    expect(lineupIssues({ team: "s1" }, byId).map((i) => i.code)).toEqual(["wrong_kind"]);
    expect(lineupIssues({ double: "c1" }, byId).map((i) => i.code)).toEqual(["double_not_driver"]);
  });
  it("flags assets that aren't available", () => {
    expect(lineupIssues({ d1: "s99" }, byId).map((i) => i.code)).toEqual(["unknown_asset"]);
  });
});

describe("tap to add", () => {
  it("fills driver slots first, then ×2 only if eligible", () => {
    const full: Picks = { d1: "s1", d2: "s2", d3: "s3", d4: "s4" };
    expect(slotFor(byId.get("s5")!, {}, null)).toBe("d1");
    expect(slotFor(byId.get("s5")!, full, null)).toBe("double");
    expect(slotFor(byId.get("s3")!, full, null)).toBeNull();
  });
  it("respects the chosen slot when the asset fits it", () => {
    expect(slotFor(byId.get("s4")!, {}, "double")).toBe("double");
    expect(slotFor(byId.get("s1")!, {}, "double")).toBe("d1");
    expect(slotFor(byId.get("c1")!, {}, "d2")).toBe("team");
  });
});
