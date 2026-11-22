"use client";

import { Fragment, useMemo, useState } from "react";
import type { PointsRow } from "@/lib/points";

/** A fixed column, or a session column as "<Session>:<label>". */
type SortKey = "total" | "season" | "last3" | "races" | "picked" | "doubled" | "ticker" | `${string}:${string}`;

const f = (n: number | null | undefined) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const neg = (n: number | null | undefined) => (n != null && n < 0 ? "text-down" : "");

/*
 * Widths: the full session breakdown shows from md up (like the sheet's
 * Points tab). When space runs out, columns go in this order: full name and
 * team first (below xl), then Last 3 and Season (below lg). On phones the
 * breakdown folds into a tap-to-open row and Season / Last 3 come back.
 */
const BRK = "hidden md:table-cell";
const NAME = "hidden xl:inline";
const STAT = "md:hidden lg:table-cell"; // Season, Last 3: phones and lg+

export function PointsTable({
  rows,
  raceName,
  raceLabel,
  locked,
}: {
  rows: PointsRow[];
  raceName: string;
  raceLabel: string;
  locked: boolean;
}) {
  const [tab, setTab] = useState<"driver" | "constructor">("driver");
  const [sort, setSort] = useState<SortKey>("total");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const isDriver = tab === "driver";
  const hasSprint = rows.some((r) => r.parts.S);


  // Session columns: [label, value getter, is the session's result column]
  type Col = { label: string; get: (r: PointsRow) => number | undefined; res?: boolean };
  const groups: { name: string; cols: Col[] }[] = [
    ...(hasSprint
      ? [
          {
            name: "Sprint",
            cols: [
              { label: "Pos", get: (r: PointsRow) => r.parts.S?.pos },
              { label: "Gain", get: (r: PointsRow) => r.parts.S?.gained },
              { label: "Over", get: (r: PointsRow) => r.parts.S?.overtakes },
              { label: "FL", get: (r: PointsRow) => r.parts.S?.fastestLap },
              { label: "Res", get: (r: PointsRow) => r.parts.S?.total, res: true },
            ],
          },
        ]
      : []),
    {
      name: "Qualifying",
      cols: [
        { label: "Pos", get: (r) => r.parts.Q?.pos },
        ...(isDriver ? [] : [{ label: "Q2/Q3", get: (r: PointsRow) => r.parts.Q?.team }]),
        { label: "Res", get: (r) => r.parts.Q?.total, res: true },
      ],
    },
    {
      name: "Race",
      cols: [
        { label: "Pos", get: (r) => r.parts.R?.pos },
        { label: "Gain", get: (r) => r.parts.R?.gained },
        { label: "Over", get: (r) => r.parts.R?.overtakes },
        { label: "FL", get: (r) => r.parts.R?.fastestLap },
        { label: isDriver ? "DotD" : "Pits", get: (r) => r.parts.R?.dotdPit },
        { label: "Res", get: (r) => r.parts.R?.total, res: true },
      ],
    },
  ];
  const nBrk = groups.reduce((s, g) => s + g.cols.length, 0);

  // Every column sorts, high to low (names A–Z).
  const value = (r: PointsRow, k: SortKey): number | null | undefined => {
    if (k.includes(":")) {
      const [g, label] = k.split(":");
      return groups.find((x) => x.name === g)?.cols.find((c) => c.label === label)?.get(r);
    }
    return r[k as "total" | "season" | "last3" | "races" | "picked" | "doubled"];
  };
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => r.kind === tab && (!s || r.ticker.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)))
      .sort((a, b) =>
        sort === "ticker"
          ? a.ticker.localeCompare(b.ticker)
          : (value(b, sort) ?? -999) - (value(a, sort) ?? -999) || a.ticker.localeCompare(b.ticker),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tab, sort, q, hasSprint]);

  const sortBtn = (k: SortKey, label: string, title?: string) => (
    <button type="button" onClick={() => setSort(k)} title={title} className={sort === k ? "text-ink underline" : ""}>
      {label}
    </button>
  );

  return (
    <section className="rounded-lg border border-line bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h1 className="mr-auto font-bold">{raceName}</h1>
        <div className="flex overflow-hidden rounded border border-line text-sm font-semibold">
          {(["driver", "constructor"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-1 ${tab === k ? "bg-navy text-white" : "text-muted"}`}
            >
              {k === "driver" ? "Drivers" : "Constructors"}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="w-28 rounded border border-line bg-transparent px-2 py-1 text-sm"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted">
            <tr className={locked ? "" : "hidden md:table-row"}>
              <th />
              {groups.map((g, gi) => (
                <th
                  key={g.name}
                  colSpan={g.cols.length}
                  className={`${BRK} px-1 pt-1 text-center font-semibold uppercase tracking-wide ${gi % 2 ? "" : "bg-bg/60"}`}
                >
                  {g.name}
                </th>
              ))}
              <th />
              <th className={STAT} />
              <th className={STAT} />
              <th className={STAT} />
              {locked && (
                <th
                  colSpan={isDriver ? 2 : 1}
                  className="border-b border-line pt-1 pr-3 pl-2 text-center font-semibold whitespace-nowrap uppercase tracking-wide"
                >
                  Picked by
                </th>
              )}
            </tr>
            <tr>
              <th className="py-1 pl-3 text-left font-semibold">{sortBtn("ticker", isDriver ? "Driver" : "Constructor")}</th>
              {groups.map((g, gi) =>
                g.cols.map((c) => (
                  <th
                    key={g.name + c.label}
                    className={`${BRK} px-1.5 text-right font-semibold ${gi % 2 ? "" : "bg-bg/60"} ${c.res ? "text-ink" : ""}`}
                  >
                    {sortBtn(`${g.name}:${c.label}`, c.label, `Sort by ${g.name} ${c.label}`)}
                  </th>
                )),
              )}
              <th className="px-2 text-right font-semibold">{sortBtn("total", "Total")}</th>
              <th className={`${STAT} px-2 text-right font-semibold`}>{sortBtn("season", "Season")}</th>
              <th className={`${STAT} px-2 text-right font-semibold`}>{sortBtn("last3", "Last 3 races")}</th>
              <th className={`${STAT} px-2 text-right font-semibold`}>
                {sortBtn("races", "Races", "Races scored in this season, up to this race")}
              </th>
              {locked && isDriver && <th className="px-2 text-right font-semibold">{sortBtn("doubled", "×2")}</th>}
              {locked && <th className="pr-3 text-right font-semibold">{sortBtn("picked", isDriver ? "×1" : "Teams")}</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const isOpen = open === r.key;
              return (
                <Fragment key={r.key}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : r.key)}
                    className={`cursor-pointer border-t border-line ${isOpen ? "bg-black/[.03] dark:bg-white/[.04]" : "hover:bg-black/[.02] dark:hover:bg-white/[.03]"}`}
                  >
                    <td className="py-1.5 pl-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="h-6 w-1 shrink-0 rounded" style={{ background: r.colour }} />
                        <b>{r.ticker}</b>
                        <span className={`${NAME} text-muted`}>
                          {r.name}
                          {r.kind === "driver" && ` · ${r.team}`}
                        </span>
                      </div>
                    </td>
                    {groups.map((g, gi) =>
                      g.cols.map((c) => {
                        const v = c.get(r);
                        return (
                          <td
                            key={g.name + c.label}
                            className={`${BRK} px-1.5 text-right ${gi % 2 ? "" : "bg-bg/60"} ${c.res ? "font-semibold" : "text-muted"} ${neg(v)}`}
                          >
                            {f(v)}
                          </td>
                        );
                      }),
                    )}
                    <td className={`px-2 text-right font-bold ${neg(r.total)}`}>{f(r.total)}</td>
                    <td className={`${STAT} px-2 text-right ${neg(r.season)}`}>{f(r.season)}</td>
                    <td className={`${STAT} px-2 text-right ${neg(r.last3)}`}>{f(r.last3)}</td>
                    <td className={`${STAT} px-2 text-right text-muted`}>{r.races}</td>
                    {locked && isDriver && (
                      <td className={`px-2 text-right ${r.doubled ? "font-semibold text-red" : "text-muted"}`}>{r.doubled}</td>
                    )}
                    {locked && <td className={`pr-3 text-right ${r.picked ? "" : "text-muted"}`}>{r.picked}</td>}
                  </tr>
                  {isOpen && (
                    <tr className="bg-black/[.03] dark:bg-white/[.04]">
                      <td colSpan={nBrk + 5 + (locked ? (isDriver ? 2 : 1) : 0)} className="px-3 pb-2 text-xs">
                        <div className="mb-1 text-muted md:hidden">
                          {r.name}
                          {r.kind === "driver" && ` · ${r.team}`}
                        </div>
                        <div className="md:hidden">
                          <Detail row={r} />
                        </div>
                        <PickedBy row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nothing to show.</p>}
      <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="md:hidden">Tap a row for the session breakdown and who picked it. </span>
        <span className="hidden md:inline">Click a row to see who picked it. </span>
        Season, Last 3 races and Races: as of {raceLabel} (this race and the ones before it). Every column header sorts.
        {locked
          ? isDriver
            ? " Picked by ×2 / ×1: how many players have them in their team this race, as their ×2 driver or as a regular pick."
            : " Picked by: how many players have them in their team this race."
          : " Who picked what is shown after the deadline."}
      </p>
    </section>
  );
}

function PickedBy({ row }: { row: PointsRow }) {
  const by = row.pickedBy;
  if (!by) return <div className="mt-1 text-muted">Teams are shown once the race locks.</div>;
  const total = by.x2.length + by.x1.length;
  return (
    <div className="mt-1 grid gap-0.5">
      {total === 0 && <div className="text-muted">Nobody picked {row.ticker}.</div>}
      {by.x2.length > 0 && (
        <div>
          <span className="mr-1 rounded bg-red px-1 text-[10px] font-bold text-white">×2</span>
          <span className="text-muted">Picked as ×2 by {by.x2.length}:</span> {by.x2.join(", ")}
        </div>
      )}
      {by.x1.length > 0 && (
        <div>
          <span className="text-muted">
            Picked{row.kind === "driver" ? " as ×1" : ""} by {by.x1.length}:
          </span>{" "}
          {by.x1.join(", ")}
        </div>
      )}
    </div>
  );
}

function Detail({ row }: { row: PointsRow }) {
  const { S, Q, R } = row.parts;
  const cell = (label: string, v: number | undefined) =>
    v == null ? null : (
      <span className="mr-3 whitespace-nowrap">
        <span className="text-muted">{label}</span> <b className={neg(v)}>{f(v)}</b>
      </span>
    );
  return (
    <div className="grid gap-1">
      {S && (
        <div>
          <b className="mr-2">Sprint {f(S.total)}</b>
          {cell("Pos", S.pos)}
          {cell("Gain", S.gained)}
          {cell("Over", S.overtakes)}
          {cell("FL", S.fastestLap)}
        </div>
      )}
      {Q && (
        <div>
          <b className="mr-2">Quali {f(Q.total)}</b>
          {cell("Pos", Q.pos)}
          {row.kind === "constructor" && cell("Q2/Q3", Q.team)}
        </div>
      )}
      {R && (
        <div>
          <b className="mr-2">Race {f(R.total)}</b>
          {cell("Pos", R.pos)}
          {cell("Gain", R.gained)}
          {cell("Over", R.overtakes)}
          {cell("FL", R.fastestLap)}
          {cell(row.kind === "driver" ? "DotD" : "Pits", R.dotdPit)}
        </div>
      )}
      {!S && !Q && !R && <span className="text-muted">No sessions yet.</span>}
    </div>
  );
}
