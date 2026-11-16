"use client";

import { useMemo, useState } from "react";

type Metric = "total" | "race" | "rank";
const PALETTE = [
  "#e10600", "#1f6feb", "#16a34a", "#f59e0b", "#9333ea", "#0891b2", "#db2777", "#65a30d",
  "#ea580c", "#4f46e5", "#0d9488", "#be123c", "#a16207", "#7c3aed", "#059669", "#b91c1c",
];

export function SeasonGraph({
  players,
  raceLabels,
  raceTotals,
  cumulative,
  ranks,
  meId,
  onClose,
}: {
  players: { id: number; name: string }[];
  raceLabels: string[];
  raceTotals: Record<number, number[]>;
  cumulative: Record<number, number[]>;
  ranks: Record<number, number[]>;
  meId: number;
  onClose: () => void;
}) {
  const [metric, setMetric] = useState<Metric>("total");
  const [compare, setCompare] = useState<number | 0>(players.some((p) => p.id === meId) ? meId : 0);
  const [shown, setShown] = useState<Set<number>>(() => new Set(players.slice(0, 25).map((p) => p.id)));
  const [hover, setHover] = useState<number | null>(null);
  const colour = (id: number) => PALETTE[players.findIndex((p) => p.id === id) % PALETTE.length];

  const series = useMemo(() => {
    const base = (id: number) => (metric === "total" ? cumulative[id] : metric === "race" ? raceTotals[id] : ranks[id]) ?? [];
    const ref = metric !== "rank" && compare ? base(compare) : null;
    return players
      .filter((p) => shown.has(p.id))
      .map((p) => ({ ...p, values: base(p.id).map((v, i) => v - (ref?.[i] ?? 0)) }));
  }, [metric, compare, shown, players, cumulative, raceTotals, ranks]);

  const W = 760, H = 360, L = 48, R = 40, T = 16, B = 36;
  const all = series.flatMap((s) => s.values);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (metric === "rank") {
    lo = 1;
    hi = Math.max(2, players.length);
  }
  if (lo === hi) hi = lo + 1;
  const n = raceLabels.length;
  const X = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const Y = (v: number) => (metric === "rank" ? T + ((v - lo) / (hi - lo)) * (H - T - B) : T + ((hi - v) / (hi - lo)) * (H - T - B));
  const nice = (v: number) => {
    const m = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(v) || 1)) - 1));
    return Math.round(v / m) * m;
  };
  const ticks =
    metric === "rank" ? [1, Math.ceil(hi / 2), hi] : [...new Set([lo, nice((lo + hi) / 2), hi, ...(lo < 0 && hi > 0 ? [0] : [])])];

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-2 md:p-6" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-lg border border-line bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
          <b className="mr-2">Season graph</b>
          <div className="flex overflow-hidden rounded border border-line font-semibold">
            {(["total", "race", "rank"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`px-2 py-0.5 ${metric === m ? "bg-navy text-white" : "text-muted"}`}
              >
                {m === "total" ? "Total points" : m === "race" ? "Race points" : "Rank"}
              </button>
            ))}
          </div>
          <label className={`flex items-center gap-1 ${metric === "rank" ? "opacity-40" : ""}`}>
            <span className="text-muted">Compare with</span>
            <select
              value={compare}
              disabled={metric === "rank"}
              onChange={(e) => setCompare(Number(e.target.value))}
              className="rounded border border-line bg-card px-1 py-0.5"
            >
              <option value={0}>nobody</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onClose} className="ml-auto px-2 text-muted" aria-label="Close">
            ✕
          </button>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - b.left) / b.width) * W;
            let best = 0;
            for (let i = 0; i < n; i++) if (Math.abs(X(i) - x) < Math.abs(X(best) - x)) best = i;
            setHover(best);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke="var(--border)" />
              <text x={L - 6} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {t}
              </text>
            </g>
          ))}
          {metric !== "rank" && <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="var(--muted)" strokeDasharray="3 3" />}
          {raceLabels.map((l, i) => (
            <text
              key={l}
              x={X(i)}
              y={H - 12}
              textAnchor={n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle"}
              fontSize="11"
              fill="var(--muted)"
            >
              {l}
            </text>
          ))}
          {hover != null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} stroke="var(--muted)" />}
          {series.map((s) => (
            <g key={s.id}>
              <polyline
                fill="none"
                stroke={colour(s.id)}
                strokeWidth={s.id === meId ? 3 : 1.5}
                points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={X(i)} cy={Y(v)} r={s.id === meId ? 3.5 : 2.5} fill={colour(s.id)} />
              ))}
            </g>
          ))}
        </svg>

        {hover != null && (
          <div className="mx-3 mb-2 rounded border border-line p-2 text-xs">
            <b>{raceLabels[hover]}</b>
            <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
              {[...series]
                .sort((a, b) => (metric === "rank" ? a.values[hover] - b.values[hover] : b.values[hover] - a.values[hover]))
                .map((s) => (
                  <span key={s.id} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: colour(s.id) }} />
                    {s.name}
                    <b className="ml-auto">{s.values[hover] > 0 && compare && metric !== "rank" ? `+${s.values[hover]}` : s.values[hover]}</b>
                  </span>
                ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1 border-t border-line px-3 py-2">
          {players.map((p) => {
            const on = shown.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const next = new Set(shown);
                  if (on) next.delete(p.id);
                  else next.add(p.id);
                  setShown(next);
                }}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${on ? "border-line" : "border-dashed border-line opacity-40"}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: colour(p.id) }} />
                {p.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
