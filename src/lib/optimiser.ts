// Best-team search used at the lock, ported from the sheet's bestFill_.
// Pure: no database. Asset ids are the app's ("s12" drivers, "c3" constructors).

export type Team = { x2: string | null; x1: string[]; c: string | null };
export type Scored = { team: Team; score: number; cost: number };

export const teamKey = (t: Team) => `${t.x2}|${[...t.x1].sort().join(",")}|${t.c}`;

/**
 * The topK highest-expected teams that keep `fixed` and stay within budget.
 * The ×2 driver scores double and must cost under the cap.
 */
export function bestFill(
  fixed: Team,
  drivers: string[],
  constructors: string[],
  xp: Record<string, number>,
  price: Record<string, number>,
  topK: number,
  budget = 100,
  doubleCap = 20,
): Scored[] {
  const used = new Set([fixed.x2, ...fixed.x1, fixed.c].filter(Boolean) as string[]);
  let spent = 0;
  used.forEach((t) => (spent += price[t] ?? 0));
  const needX1 = 4 - fixed.x1.length;
  const out: Scored[] = [];
  const fixedScore =
    (fixed.x2 ? 2 * (xp[fixed.x2] ?? 0) : 0) +
    fixed.x1.reduce((s, t) => s + (xp[t] ?? 0), 0) +
    (fixed.c ? xp[fixed.c] ?? 0 : 0);
  const x2opts: (string | null)[] = fixed.x2
    ? [null]
    : drivers.filter((t) => !used.has(t) && (price[t] ?? 0) < doubleCap);
  const cOpts: (string | null)[] = fixed.c ? [null] : constructors.filter((t) => !used.has(t));
  const push = (team: Team, score: number, cost: number) => {
    if (out.length < topK || score > out[out.length - 1].score) {
      let i = out.length;
      while (i > 0 && out[i - 1].score < score) i--;
      out.splice(i, 0, { team, score, cost: Math.round(cost * 100) / 100 });
      if (out.length > topK) out.pop();
    }
  };
  const eps = 1e-9;
  for (const x2 of x2opts) {
    const c2 = x2 ? price[x2] ?? 0 : 0;
    const s2 = x2 ? 2 * (xp[x2] ?? 0) : 0;
    if (spent + c2 > budget + eps) continue;
    const pool = drivers.filter((t) => !used.has(t) && t !== x2);
    const chosen: string[] = [];
    const rec = (start: number, cost: number, score: number) => {
      if (chosen.length === needX1) {
        for (const c of cOpts) {
          const cc = c ? price[c] ?? 0 : 0;
          if (spent + c2 + cost + cc > budget + eps) continue;
          push(
            { x2: fixed.x2 ?? x2, x1: [...fixed.x1, ...chosen], c: fixed.c ?? c },
            fixedScore + s2 + score + (c ? xp[c] ?? 0 : 0),
            spent + c2 + cost + cc,
          );
        }
        return;
      }
      for (let i = start; i < pool.length; i++) {
        const t = pool[i];
        const p = price[t] ?? 0;
        if (spent + c2 + cost + p > budget + eps) continue;
        chosen.push(t);
        rec(i + 1, cost + p, score + (xp[t] ?? 0));
        chosen.pop();
      }
    };
    rec(0, 0, 0);
  }
  return out;
}

export function combos<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const cur: T[] = [];
  const r = (s: number) => {
    if (cur.length === k) {
      res.push([...cur]);
      return;
    }
    for (let i = s; i < arr.length; i++) {
      cur.push(arr[i]);
      r(i + 1);
      cur.pop();
    }
  };
  r(0);
  return res;
}

type Pick = { slot: "x2" | "x1" | "c"; v: string };

/**
 * A partial team keeps as many of its picks as possible: try keeping all,
 * then dropping 1, then 2... and take the best affordable fill.
 */
export function fillPartial(
  team: Team,
  drivers: string[],
  constructors: string[],
  xp: Record<string, number>,
  price: Record<string, number>,
  budget = 100,
  doubleCap = 20,
): Scored | null {
  const picks: Pick[] = [];
  if (team.x2) picks.push({ slot: "x2", v: team.x2 });
  team.x1.forEach((v) => picks.push({ slot: "x1", v }));
  if (team.c) picks.push({ slot: "c", v: team.c });
  for (let drop = 0; drop <= picks.length; drop++) {
    let best: Scored | null = null;
    for (const rem of combos(picks.map((_, i) => i), drop)) {
      const keep = picks.filter((_, i) => !rem.includes(i));
      const fx: Team = {
        x2: keep.find((p) => p.slot === "x2")?.v ?? null,
        x1: keep.filter((p) => p.slot === "x1").map((p) => p.v),
        c: keep.find((p) => p.slot === "c")?.v ?? null,
      };
      const r = bestFill(fx, drivers, constructors, xp, price, 1, budget, doubleCap)[0];
      if (r && (!best || r.score > best.score)) best = r;
    }
    if (best) return best;
  }
  return null;
}

/** Distinct random teams from the top expected teams, avoiding the ones players already picked. */
export function randomTeams(
  count: number,
  taken: Set<string>,
  drivers: string[],
  constructors: string[],
  xp: Record<string, number>,
  price: Record<string, number>,
  rng: () => number = Math.random,
  budget = 100,
  doubleCap = 20,
): Scored[] {
  if (count <= 0) return [];
  const pool: Scored[] = [];
  const seen = new Set<string>();
  for (const r of bestFill({ x2: null, x1: [], c: null }, drivers, constructors, xp, price, 300, budget, doubleCap)) {
    const k = teamKey(r.team);
    if (seen.has(k) || taken.has(k)) continue;
    seen.add(k);
    pool.push(r);
    if (pool.length >= Math.max(10, count)) break;
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
