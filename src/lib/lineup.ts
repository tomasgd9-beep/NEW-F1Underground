// Lineup rules, pure (no database), shared by the browser and the server.
// Ported from the 2026 app's lineup-rules.ts and the sheet's formulas.

export const SLOTS = ["double", "d1", "d2", "d3", "d4", "team"] as const;
export type Slot = (typeof SLOTS)[number];
export const DRIVER_SLOTS: Slot[] = ["d1", "d2", "d3", "d4"];

/** Asset ids: "s<stintId>" for a driver (current stint), "c<constructorId>" for a constructor. */
export type AssetId = string;
export type Picks = Partial<Record<Slot, AssetId | null>>;

export type LineupAsset = {
  id: AssetId;
  kind: "driver" | "constructor";
  price: number;
};

export type Issue =
  | { code: "duplicate"; assetId: AssetId }
  | { code: "double_not_driver"; assetId: AssetId }
  | { code: "double_price_cap"; assetId: AssetId; price: number }
  | { code: "wrong_kind"; slot: Slot; assetId: AssetId }
  | { code: "unknown_asset"; slot: Slot; assetId: AssetId };

export const driverId = (stintId: number): AssetId => `s${stintId}`;
export const constructorAssetId = (constructorId: number): AssetId => `c${constructorId}`;

export function parseAssetId(id: AssetId): { kind: "driver" | "constructor"; num: number } | null {
  const m = /^([sc])(\d+)$/.exec(id);
  if (!m) return null;
  return { kind: m[1] === "s" ? "driver" : "constructor", num: Number(m[2]) };
}

/** Rounded to 2 decimals to avoid float drift (prices have 2 decimals). */
export function teamPrice(picks: Picks, byId: ReadonlyMap<AssetId, LineupAsset>): number {
  let sum = 0;
  for (const s of SLOTS) {
    const id = picks[s];
    const a = id ? byId.get(id) : undefined;
    if (a) sum += a.price;
  }
  return Math.round(sum * 100) / 100;
}

/** −10 points per whole or partial unit over the budget (100.3 → −10, 101.5 → −20). */
export function budgetPenalty(price: number, budget = 100): number {
  if (price <= budget + 1e-9) return 0;
  return -10 * Math.ceil(price - budget - 1e-9);
}

/** Rule problems that block saving. Empty slots are allowed (the lock auto-fills them). */
export function lineupIssues(
  picks: Picks,
  byId: ReadonlyMap<AssetId, LineupAsset>,
  doubleCap = 20,
): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<AssetId>();
  for (const slot of SLOTS) {
    const id = picks[slot];
    if (!id) continue;
    const a = byId.get(id);
    if (!a) {
      issues.push({ code: "unknown_asset", slot, assetId: id });
      continue;
    }
    if (seen.has(id)) issues.push({ code: "duplicate", assetId: id });
    seen.add(id);
    if (slot === "double") {
      if (a.kind !== "driver") issues.push({ code: "double_not_driver", assetId: id });
      else if (a.price >= doubleCap) issues.push({ code: "double_price_cap", assetId: id, price: a.price });
    } else if ((slot === "team") !== (a.kind === "constructor")) {
      issues.push({ code: "wrong_kind", slot, assetId: id });
    }
  }
  return issues;
}

export function emptySlots(picks: Picks): Slot[] {
  return SLOTS.filter((s) => !picks[s]);
}

/** Where a tapped asset should go: the chosen slot if it fits, else the first suitable empty one. */
export function slotFor(
  asset: LineupAsset,
  picks: Picks,
  preferred: Slot | null,
  doubleCap = 20,
): Slot | null {
  const fits = (s: Slot) =>
    asset.kind === "constructor"
      ? s === "team"
      : s !== "team" && (s !== "double" || asset.price < doubleCap);
  if (preferred && fits(preferred)) return preferred;
  const order: Slot[] = asset.kind === "constructor" ? ["team"] : [...DRIVER_SLOTS, "double"];
  return order.find((s) => fits(s) && !picks[s]) ?? null;
}

export function describeIssue(i: Issue, name: (id: AssetId) => string, doubleCap = 20): string {
  switch (i.code) {
    case "duplicate":
      return `${name(i.assetId)} is in your team twice.`;
    case "double_not_driver":
      return "The ×2 slot takes a driver.";
    case "double_price_cap":
      return `${name(i.assetId)} costs ${i.price.toFixed(2)}; the ×2 driver must cost under ${doubleCap}.`;
    case "wrong_kind":
      return i.slot === "team" ? "The constructor slot takes a constructor." : "Driver slots take drivers.";
    case "unknown_asset":
      return "One of your picks is no longer available; pick someone else.";
  }
}
