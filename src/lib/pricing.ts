// The league's price formula (see the plan's League rules). Pure.
//   races = 0: last season price
//   races = 1: 0.34 · Last3/1.089 + 0.66 · last season price
//   races = 2: 0.67 · (Last3/2)/1.089 + 0.33 · last season price
//   races = 3: (Last3/3)/1.089
// Then any price at or below 1 is raised to the cheapest price above 1.

export function formulaPrice(lastSeasonPrice: number, last3: number, races: number): number {
  const r = Math.min(3, Math.max(0, races));
  if (r === 0) return lastSeasonPrice;
  if (r === 1) return 0.34 * (last3 / 1.089) + 0.66 * lastSeasonPrice;
  if (r === 2) return 0.67 * (last3 / 2 / 1.089) + 0.33 * lastSeasonPrice;
  return last3 / 3 / 1.089;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Apply the floor: everything at or below 1 becomes the cheapest price above 1. */
export function applyFloor(prices: number[], counts?: boolean[]): number[] {
  // The floor is the cheapest price above 1 among drivers and teams still racing
  // (an inactive driver's leftover price doesn't set it), as the sheet did.
  const above = prices.filter((p, i) => p > 1 && (counts?.[i] ?? true));
  const floor = above.length ? Math.min(...above) : 1;
  return prices.map((p) => (p <= 1 ? floor : p));
}
