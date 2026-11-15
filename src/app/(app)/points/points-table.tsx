"use client";

import { Fragment, useMemo, useState } from "react";
import type { PointsRow } from "@/lib/points";

type SortKey = "total" | "season" | "last3" | "picked" | "ticker";

const f = (n: number | null | undefined) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const neg = (n: number | null | undefined) => (n != null && n < 0 ? "text-down" : "");

export function PointsTable({ rows, raceName, locked }: { rows: PointsRow[]; raceName: string; locked: boolean }) {
  const [tab, setTab] = useState<"driver" | "constructor">("driver");
  const [sort, setSort] = useState<SortKey>("total");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => r.kind === tab && (!s || r.ticker.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)))
      .sort((a, b) =>
        sort === "ticker"
          ? a.ticker.localeCompare(b.ticker)
          : (b[sort] ?? -999) - (a[sort] ?? -999) || a.ticker.localeCompare(b.ticker),
      );
  }, [rows, tab, sort, q]);

  const Th = ({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`px-2 py-1 text-right font-semibold ${className}`}>
      <button type="button" onClick={() => setSort(k)} className={sort === k ? "text-ink underline" : ""}>
        {children}
      </button>
    </th>
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
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pl-3 text-left font-semibold">
              <button type="button" onClick={() => setSort("ticker")} className={sort === "ticker" ? "text-ink underline" : ""}>
                {tab === "driver" ? "Driver" : "Constructor"}
              </button>
            </th>
            <th className="hidden px-2 text-right font-semibold md:table-cell">Sprint</th>
            <th className="hidden px-2 text-right font-semibold md:table-cell">Quali</th>
            <th className="hidden px-2 text-right font-semibold md:table-cell">Race</th>
            <Th k="total">Total</Th>
            <Th k="season">Season</Th>
            <Th k="last3">Last 3</Th>
            {locked && (
              <Th k="picked" className="pr-3">
                Picked
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const isOpen = open === r.key;
            return (
              <Fragment key={r.key}>
                <tr
                  onClick={() => setOpen(isOpen ? null : r.key)}
                  className={`cursor-pointer border-t border-line ${isOpen ? "bg-black/[.03] dark:bg-white/[.04]" : ""}`}
                >
                  <td className="py-1.5 pl-3">
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-1 shrink-0 rounded" style={{ background: r.colour }} />
                      <b>{r.ticker}</b>
                      <span className="hidden text-muted sm:inline">
                        {r.name}
                        {r.kind === "driver" && ` · ${r.team}`}
                      </span>
                    </div>
                  </td>
                  <td className={`hidden px-2 text-right md:table-cell ${neg(r.parts.S?.total)}`}>{f(r.parts.S?.total)}</td>
                  <td className={`hidden px-2 text-right md:table-cell ${neg(r.parts.Q?.total)}`}>{f(r.parts.Q?.total)}</td>
                  <td className={`hidden px-2 text-right md:table-cell ${neg(r.parts.R?.total)}`}>{f(r.parts.R?.total)}</td>
                  <td className={`px-2 text-right font-bold ${neg(r.total)}`}>{f(r.total)}</td>
                  <td className={`px-2 text-right ${neg(r.season)}`}>{f(r.season)}</td>
                  <td className={`px-2 text-right ${neg(r.last3)}`}>{f(r.last3)}</td>
                  {locked && (
                    <td className="pr-3 text-right whitespace-nowrap">
                      {r.picked}
                      {r.doubled ? <span className="ml-1 text-[11px] text-red">×2:{r.doubled}</span> : null}
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="bg-black/[.03] dark:bg-white/[.04]">
                    <td colSpan={locked ? 8 : 7} className="px-3 pb-2 text-xs">
                      <Detail row={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {list.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nothing to show.</p>}
      <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        Tap a row for the session breakdown. Season and Last 3 are as of now.
        {!locked && " Picks are shown after the deadline."}
      </p>
    </section>
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
          <b className="mr-2">Sprint</b>
          {cell("Position", S.pos)}
          {cell("Gained", S.gained)}
          {cell("Overtakes", S.overtakes)}
          {cell("Fastest lap", S.fastestLap)}
        </div>
      )}
      {Q && (
        <div>
          <b className="mr-2">Qualifying</b>
          {cell("Position", Q.pos)}
          {row.kind === "constructor" && cell("Q2/Q3 bonus", Q.team)}
        </div>
      )}
      {R && (
        <div>
          <b className="mr-2">Race</b>
          {cell("Position", R.pos)}
          {cell("Gained", R.gained)}
          {cell("Overtakes", R.overtakes)}
          {cell("Fastest lap", R.fastestLap)}
          {cell(row.kind === "driver" ? "Driver of the Day" : "Pit stops", R.dotdPit)}
        </div>
      )}
      {!S && !Q && !R && <span className="text-muted">No sessions yet.</span>}
    </div>
  );
}
