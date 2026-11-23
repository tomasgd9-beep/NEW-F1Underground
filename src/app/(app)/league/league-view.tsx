"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LeagueData, LeagueRace } from "@/lib/league-data";
import { heat, orderPicks, rankHistory, shareRanks, standings, teamScore, type StandingRow } from "@/lib/standings";
import { SeasonGraph } from "./season-graph";
import { LeagueHeader } from "@/components/league-header";
import { RacePicker } from "@/components/race-picker";
import { SharePanel } from "./share-panel";

const f = (n: number | null | undefined) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const neg = (n: number | null | undefined) => (n != null && n < 0 ? "text-down" : "");
const BADGE: Record<string, string> = {
  live: "bg-red text-white",
  provisional: "bg-navy text-white",
  final: "bg-black/10 dark:bg-white/15",
  none: "bg-black/10 dark:bg-white/15",
};

function Move({ m }: { m: number | null }) {
  if (!m) return <span className="text-muted">–</span>;
  return <span className={m > 0 ? "text-up" : "text-down"}>{m > 0 ? `▲${m}` : `▼${-m}`}</span>;
}

export function LeagueView({
  data,
  leagueName,
  code,
  joinUrl,
}: {
  data: LeagueData | null;
  leagueName: string;
  code: string | null;
  joinUrl: string;
}) {
  const [view, setView] = useState<"race" | "season">("race");

  const header = (
    <LeagueHeader
      leagueName={leagueName}
      seasons={data?.seasons ?? []}
      seasonId={data?.season.id ?? null}
      basePath="/league"
      code={code}
      joinUrl={joinUrl}
      right={
        data && (
          <div className="flex overflow-hidden rounded border border-line text-xs font-semibold sm:text-sm">
            {(["race", "season"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                className={`px-2 py-0.5 sm:px-3 sm:py-1 ${view === k ? "bg-navy text-white" : "bg-card text-muted"}`}
              >
                {k === "race" ? "Race" : "Season"}
              </button>
            ))}
          </div>
        )
      }
    />
  );

  if (!data || data.races.length === 0) {
    return (
      <div className="grid gap-3">
        {header}
        <section className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
          No races yet. Standings appear once the first race is locked.
        </section>
      </div>
    );
  }
  return <Inner data={data} header={header} view={view} setView={setView} />;
}

function Inner({
  data,
  header,
  view,
  setView,
}: {
  data: LeagueData;
  header: React.ReactNode;
  view: "race" | "season";
  setView: (v: "race" | "season") => void;
}) {
  const playerIds = data.players.map((p) => p.id);
  const name = (id: number) => data.players.find((p) => p.id === id)?.name ?? "?";
  const scoredRaces = data.races.filter((r) => r.locked && r.results !== "none");

  const scoreOf = (pid: number, rid: number) => {
    const t = data.teams[rid]?.[pid];
    return t ? teamScore(t, data.points[rid]) : null;
  };

  // Default race: the latest locked race with points, else the open race.
  const defaultRace = scoredRaces.at(-1)?.id ?? data.races.at(-1)!.id;
  const [raceId, setRaceId] = useState(defaultRace);
  const [focusPlayer, setFocusPlayer] = useState<number | null>(null);

  return (
    <div className="grid gap-3">
      {header}
      {view === "race" ? (
        <RaceView
          data={data}
          raceId={raceId}
          setRaceId={setRaceId}
          name={name}
          scoreOf={scoreOf}
          playerIds={playerIds}
          scoredRaces={scoredRaces}
          focusPlayer={focusPlayer}
        />
      ) : (
        <SeasonView
          data={data}
          name={name}
          scoreOf={scoreOf}
          playerIds={playerIds}
          scoredRaces={scoredRaces}
          openRace={(rid, pid) => {
            setRaceId(rid);
            setFocusPlayer(pid);
            setView("race");
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Race view ───────────────────────────── */

function RaceView({
  data,
  raceId,
  setRaceId,
  name,
  scoreOf,
  playerIds,
  scoredRaces,
  focusPlayer,
}: {
  data: LeagueData;
  raceId: number;
  setRaceId: (id: number) => void;
  name: (id: number) => string;
  scoreOf: (pid: number, rid: number) => { total: number; x2: number } | null;
  playerIds: number[];
  scoredRaces: LeagueRace[];
  focusPlayer: number | null;
}) {
  const race = data.races.find((r) => r.id === raceId) ?? data.races.at(-1)!;
  const [chip, setChip] = useState<{ assetId: string; playerId: number; pinned: boolean; x: number; y: number } | null>(null);
  // Mouse hover lights up who else has a pick (no box); a click pins it and opens the box.
  const [hoverAsset, setHoverAsset] = useState<string | null>(null);
  const lit = chip?.assetId ?? hoverAsset;

  useEffect(() => {
    if (focusPlayer) document.getElementById(`p-${focusPlayer}`)?.scrollIntoView({ block: "center" });
  }, [focusPlayer, raceId]);

  // Season movement at this race.
  const upto = scoredRaces.filter((r) => data.races.indexOf(r) <= data.races.indexOf(race)).map((r) => r.id);
  const season = useMemo(() => standings(playerIds, upto, scoreOf), [raceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const moveOf = (pid: number) => season.find((s) => s.playerId === pid)?.move ?? null;

  const raceSelector = (
    <div className="flex items-center gap-2">
      <RacePicker
        races={data.races}
        currentId={race.id}
        onSelect={(id) => {
          setRaceId(id);
          setChip(null);
        }}
      />
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${BADGE[race.results]}`}>
        {race.locked ? (race.results === "none" ? "Locked" : race.results) : "Open"}
      </span>
      {race.locked && <SharePanel raceId={race.id} raceLabel={race.label} />}
    </div>
  );

  if (!race.locked) {
    const done = new Set(data.submitted[race.id] ?? []);
    return (
      <section className="grid gap-2">
        {raceSelector}
        <div className="rounded-lg border border-line bg-card">
          <p className="border-b border-line px-3 py-2 text-sm">
            <b>{race.name}</b>{" "}
            <span className="text-muted">
              · teams are hidden until the deadline. {done.size} of {data.players.length} saved.
            </span>
          </p>
          <div className="flex border-b border-line px-3 py-1 text-xs font-semibold text-muted">
            Player
            <span className="ml-auto">Team saved for {race.label}?</span>
          </div>
          <ul className="divide-y divide-line">
            {data.players.map((p) => (
              <li
                key={p.id}
                className={`flex items-center px-3 py-1.5 text-sm ${p.id === data.meId ? "bg-red/5 font-semibold" : ""}`}
              >
                {p.name}
                <span className={`ml-auto ${done.has(p.id) ? "text-up" : "text-muted"}`}>
                  {done.has(p.id) ? "✓ Saved" : "Not yet"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  const pts = data.points[race.id] ?? {};
  const rows = playerIds
    .map((pid) => ({ pid, team: data.teams[race.id]?.[pid], score: scoreOf(pid, race.id) }))
    .filter((r) => r.team)
    .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
  const ranks = shareRanks(rows, (a, b) => (a.score?.total ?? 0) === (b.score?.total ?? 0));
  const holders = (assetId: string) =>
    rows.filter((r) => r.team!.picks.some((p) => p.assetId === assetId)).map((r) => r.pid);

  return (
    <section className="grid gap-2">
      {raceSelector}
      <div className="rounded-lg border border-line bg-card">
        <p className="border-b border-line px-3 py-2 text-sm">
          <b>{race.name}</b>{" "}
          <span className="text-muted">· tap a pick for a breakdown of its details and who else has it</span>
        </p>
        <ul className="divide-y divide-line">
          {rows.map((r, i) => {
            const team = r.team!;
            const chips = orderPicks(team.picks, pts).map((p) => ({ ...p, a: data.assets[p.assetId] }));
            const me = r.pid === data.meId;
            return (
              <li
                key={r.pid}
                id={`p-${r.pid}`}
                className={`grid grid-cols-[2rem_1fr_auto] items-center gap-x-2 gap-y-1 px-3 py-1.5 md:grid-cols-[2rem_9rem_4rem_2.5rem_1fr] ${
                  me ? "bg-red/5" : ""
                } ${focusPlayer === r.pid ? "bg-navy/5" : ""}`}
              >
                <span className="text-sm font-bold text-muted">{ranks[i]}</span>
                <span className="truncate text-sm font-semibold">
                  {name(r.pid)}
                  {team.origin !== "manual" && (
                    <span className="ml-1 rounded bg-black/10 px-1 text-[10px] font-semibold uppercase dark:bg-white/10">
                      {team.origin === "random" ? "Random" : "Auto"}
                    </span>
                  )}
                </span>
                <span className="text-right whitespace-nowrap md:order-none">
                  <b className={neg(r.score?.total)}>{f(r.score?.total)}</b>
                  <span className="ml-2 text-xs md:hidden">
                    <Move m={moveOf(r.pid)} />
                  </span>
                </span>
                <span className="hidden text-xs md:block">
                  <Move m={moveOf(r.pid)} />
                </span>
                <div className="col-span-3 flex items-center gap-1 md:col-span-1">
                  <div className="grid flex-1 grid-cols-6 gap-1 md:max-w-[34rem]">
                    {chips.length === 0 && (
                      <span className="col-span-6 text-xs text-muted">Picks not recorded in the old spreadsheet</span>
                    )}
                    {chips.map((c) => {
                      const on = lit === c.assetId;
                      const colour = c.a?.colour ?? "#888888";
                      return (
                        <button
                          key={c.assetId + c.slot}
                          type="button"
                          onPointerEnter={(e) => e.pointerType === "mouse" && setHoverAsset(c.assetId)}
                          onPointerLeave={(e) => e.pointerType === "mouse" && setHoverAsset(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            const b = e.currentTarget.getBoundingClientRect();
                            setChip({ assetId: c.assetId, playerId: r.pid, pinned: true, x: b.left, y: b.bottom });
                          }}
                          style={{
                            borderLeftColor: colour,
                            ...(on ? { background: `${colour}26`, boxShadow: `inset 0 0 0 1px ${colour}` } : {}),
                          }}
                          className={`relative flex min-w-0 flex-col items-start rounded-sm border-l-[3px] bg-black/[.03] px-1.5 py-0.5 text-left leading-tight transition-opacity md:flex-row md:items-center md:justify-between md:gap-1 dark:bg-white/[.05] ${
                            c.slot === "c" ? "col-start-6" : ""
                          }`}
                        >
                          <span className="flex items-center gap-0.5 text-xs font-bold">
                            {c.a?.ticker ?? "?"}
                            {c.slot === "x2" && <span className="text-[9px] font-bold text-red">×2</span>}
                          </span>
                          <span className={`text-xs tabular-nums ${neg(c.v)}`}>{f(c.v)}</span>
                        </button>
                      );
                    })}
                  </div>
                  {team.penalty < 0 && (
                    <span className="rounded bg-down/10 px-1.5 py-0.5 text-xs font-semibold text-down">{team.penalty}</span>
                  )}
                  {!!team.adjust && (
                    <span
                      title="Correction so this race matches the 2026 spreadsheet"
                      className="rounded bg-black/5 px-1.5 py-0.5 text-xs text-muted dark:bg-white/10"
                    >
                      sheet {team.adjust > 0 ? "+" : ""}
                      {team.adjust}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {chip && (
        <ChipDetail
          data={data}
          raceId={race.id}
          assetId={chip.assetId}
          playerId={chip.playerId}
          holders={holders(chip.assetId).map(name)}
          pos={chip}
          onClose={() => setChip(null)}
        />
      )}
    </section>
  );
}

function ChipDetail({
  data,
  raceId,
  assetId,
  playerId,
  holders,
  pos,
  onClose,
}: {
  data: LeagueData;
  raceId: number;
  assetId: string;
  playerId: number;
  holders: string[];
  pos: { x: number; y: number; pinned: boolean };
  onClose: () => void;
}) {
  // Phones: the box is pinned to the bottom; leave the same amount of room under the
  // table so the last teams can still be scrolled into view above it.
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetH, setSheetH] = useState(0);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const a = data.assets[assetId];
  const parts = data.parts[raceId]?.[assetId] ?? {};
  const isX2 = data.teams[raceId]?.[playerId]?.picks.some((p) => p.assetId === assetId && p.slot === "x2");
  const m = isX2 ? 2 : 1;
  const st = data.stats[a?.statKey ?? ""] ?? { season: 0, last3: 0 };
  const line = (label: string, v: number | undefined) =>
    v == null ? null : (
      <span className="mr-2 whitespace-nowrap">
        <span className="text-muted">{label}</span> <b className={neg(v * m)}>{f(v * m)}</b>
      </span>
    );
  const body = (
    <div className="grid gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 text-sm">
        <span className="h-4 w-1 rounded" style={{ background: a?.colour }} />
        <b>{a?.ticker}</b>
        <span className="truncate text-muted">{a?.kind === "driver" ? `${a.name} · ${a.team}` : a?.name}</span>
        {isX2 && <span className="rounded bg-red px-1 text-[10px] font-bold text-white">×2 applied</span>}
        {pos.pinned && (
          <button type="button" onClick={onClose} className="ml-auto px-1 text-muted" aria-label="Close">
            ✕
          </button>
        )}
      </div>
      {parts.S && (
        <div>
          <b className="mr-1">Sprint {f(parts.S.total * m)}</b>
          {line("Pos", parts.S.pos)}
          {line("Gained", parts.S.gained)}
          {line("Overtakes", parts.S.overtakes)}
          {line("FL", parts.S.fastestLap)}
        </div>
      )}
      {parts.Q && (
        <div>
          <b className="mr-1">Quali {f(parts.Q.total * m)}</b>
          {line("Pos", parts.Q.pos)}
          {a?.kind === "constructor" && line("Q2/Q3", parts.Q.team)}
        </div>
      )}
      {parts.R && (
        <div>
          <b className="mr-1">Race {f(parts.R.total * m)}</b>
          {line("Pos", parts.R.pos)}
          {line("Gained", parts.R.gained)}
          {line("Overtakes", parts.R.overtakes)}
          {line("FL", parts.R.fastestLap)}
          {line(a?.kind === "driver" ? "DotD" : "Pits", parts.R.dotdPit)}
        </div>
      )}
      <div>
        <span className="text-muted">Season</span> <b>{f(st.season)}</b> · <span className="text-muted">Last 3</span>{" "}
        <b>{f(st.last3)}</b>
      </div>
      <div>
        <span className="text-muted">Picked by {holders.length}:</span> {holders.join(", ")}
      </div>
    </div>
  );
  // Phones: bottom sheet. Desktop: pop-up under the chip.
  return (
    <>
      <div aria-hidden className="md:hidden" style={{ height: sheetH }} />
      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg md:hidden"
      >
        {body}
      </div>
      <div
        className="fixed z-30 hidden w-80 rounded-lg border border-line bg-card p-3 shadow-lg md:block"
        style={{ left: Math.min(pos.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340), top: pos.y + 6 }}
      >
        {body}
      </div>
    </>
  );
}

/* ───────────────────────────── Season view ───────────────────────────── */

function SeasonView({
  data,
  name,
  scoreOf,
  playerIds,
  scoredRaces,
  openRace,
}: {
  data: LeagueData;
  name: (id: number) => string;
  scoreOf: (pid: number, rid: number) => { total: number; x2: number } | null;
  playerIds: number[];
  scoredRaces: LeagueRace[];
  openRace: (raceId: number, playerId: number) => void;
}) {
  const [from, setFrom] = useState<number>(scoredRaces[0]?.id ?? 0);
  const [graph, setGraph] = useState(false);
  // Race table sort: a race column (index into `races`), or null for the standings order.
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  // The race grid opens scrolled to the latest races (the Total column stays pinned on the right).
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [from]);
  const races = scoredRaces.slice(Math.max(0, scoredRaces.findIndex((r) => r.id === from)));
  const raceIds = races.map((r) => r.id);
  const rows: StandingRow[] = useMemo(() => standings(playerIds, raceIds, scoreOf), [from]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scoredRaces.length) {
    return <section className="rounded-lg border border-line bg-card p-4 text-sm text-muted">No scored races yet.</section>;
  }
  const raceRows =
    sort == null
      ? rows
      : [...rows].sort((a, b) => sort.dir * ((b.perRace[sort.col] ?? -1e9) - (a.perRace[sort.col] ?? -1e9)) || a.rank - b.rank);
  const sortBy = (col: number) =>
    setSort((cur) => (cur?.col === col ? (cur.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  const range = raceIds.map((rid) => {
    const vals = rows.map((r) => r.perRace[raceIds.indexOf(rid)]).filter((v): v is number => v != null);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  });

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-muted">Count from</span>
          <select
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
            className="rounded border border-line bg-card px-1.5 py-0.5"
          >
            {scoredRaces.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <SharePanel raceId={scoredRaces.at(-1)!.id} raceLabel={scoredRaces.at(-1)!.label} />
        <button type="button" onClick={() => setGraph(true)} className="rounded bg-navy px-3 py-1 font-semibold text-white">
          Graph
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pl-3 text-left font-semibold">#</th>
              <th className="w-8 px-1 text-left font-semibold" title="Places moved since the previous race">±</th>
              <th className="px-1.5 text-left font-semibold sm:px-2">Player</th>
              <th className="px-1.5 text-right font-semibold sm:px-2">Total</th>
              <th className="px-1.5 text-right font-semibold sm:px-2" title="Points behind the player above">Gap</th>
              <th className="px-1.5 text-right font-semibold whitespace-nowrap sm:px-2">Gap 1st</th>
              <th className="hidden pr-3 pl-2 text-right font-semibold sm:table-cell">Last race</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} className={`border-t border-line ${r.playerId === data.meId ? "bg-red/5 font-semibold" : ""}`}>
                <td className="py-1.5 pl-3 font-bold text-muted">{r.rank}</td>
                <td className="px-1 text-xs whitespace-nowrap">
                  <Move m={r.move} />
                </td>
                <td className="max-w-[9rem] truncate px-1.5 sm:max-w-none sm:px-2">{name(r.playerId)}</td>
                <td className={`px-1.5 text-right font-bold sm:px-2 ${neg(r.total)}`}>{f(r.total)}</td>
                <td className="px-1.5 text-right font-semibold sm:px-2">{r.gapAbove == null ? "" : r.gapAbove === 0 ? "0" : `−${f(r.gapAbove)}`}</td>
                <td className="px-1.5 text-right text-muted sm:px-2">{r.gapLeader == null ? "" : r.gapLeader === 0 ? "0" : `−${f(r.gapLeader)}`}</td>
                <td className={`hidden pr-3 pl-2 text-right sm:table-cell ${neg(r.lastRace)}`}>{f(r.lastRace)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div ref={gridRef} className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="sticky left-0 bg-card py-1 pl-3 pr-2 text-left font-semibold">
                <button type="button" onClick={() => setSort(null)} className={sort == null ? "text-ink underline" : ""}>
                  Player
                </button>
              </th>
              {races.map((r, i) => (
                <th key={r.id} className="px-1 text-right font-semibold whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => sortBy(i)}
                    className={`rounded px-1 py-0.5 ${sort?.col === i ? "bg-navy text-white" : "hover:text-ink"}`}
                    title={`Sort by ${r.label}`}
                  >
                    {r.label}
                    {sort?.col === i && (sort.dir === 1 ? " ↓" : " ↑")}
                  </button>
                </th>
              ))}
              <th className="sticky right-0 border-l border-line bg-card px-2 text-right font-semibold">
                <button
                  type="button"
                  onClick={() => setSort(null)}
                  className={`rounded px-1 py-0.5 ${sort == null ? "bg-navy text-white" : "hover:text-ink"}`}
                  title="Sort by season total"
                >
                  Total
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {raceRows.map((r) => (
              <tr key={r.playerId} className={`border-t border-line ${r.playerId === data.meId ? "font-semibold" : ""}`}>
                <td className="sticky left-0 bg-card py-1 pl-3 pr-2 whitespace-nowrap">{name(r.playerId)}</td>
                {races.map((race, i) => {
                  const v = r.perRace[i];
                  return (
                    <td key={race.id} className="p-0.5 text-right">
                      {v == null ? (
                        <span className="px-1.5 text-muted">–</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRace(race.id, r.playerId)}
                          className="w-full rounded px-1.5 py-0.5 text-right"
                          style={{ background: heat(v, range[i].min, range[i].max) }}
                          title={`${name(r.playerId)} · ${race.label}: open the team`}
                        >
                          {f(v)}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className={`sticky right-0 border-l border-line bg-card px-2 text-right font-bold ${neg(r.total)}`}>
                  {f(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {graph && (
        <SeasonGraph
          players={rows.map((r) => ({ id: r.playerId, name: name(r.playerId) }))}
          raceLabels={races.map((r) => r.label)}
          raceTotals={Object.fromEntries(rows.map((r) => [r.playerId, r.perRace.map((v) => v ?? 0)]))}
          cumulative={Object.fromEntries(rows.map((r) => [r.playerId, r.cumulative]))}
          ranks={rankHistory(playerIds, raceIds, scoreOf)}
          meId={data.meId}
          onClose={() => setGraph(false)}
        />
      )}
    </section>
  );
}
