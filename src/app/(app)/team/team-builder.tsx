"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Countdown } from "@/components/countdown";
import {
  SLOTS,
  budgetPenalty,
  describeIssue,
  lineupIssues,
  slotFor,
  teamPrice,
  type AssetId,
  type Picks,
  type Slot,
} from "@/lib/lineup";
import type { TeamAsset } from "@/lib/team";
import { saveTeam } from "./actions";

type RaceInfo = {
  id: number;
  label: string;
  name: string;
  isSprint: boolean;
  deadline: string | null;
  locked: boolean;
};

const SLOT_LABEL: Record<Slot, string> = { double: "D1", d1: "D2", d2: "D3", d3: "D4", d4: "D5", team: "C" };
type SortKey = "price" | "season" | "last3" | "name";

const fmt = (n: number) => n.toFixed(2);
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function ago(iso: string, now: number) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TeamBuilder({
  race,
  budget,
  doubleCap,
  assets,
  initialPicks,
  savedAt: initialSavedAt,
  origin,
}: {
  race: RaceInfo;
  budget: number;
  doubleCap: number;
  assets: TeamAsset[];
  initialPicks: Picks;
  savedAt: string | null;
  origin: "manual" | "random" | "auto_filled" | null;
}) {
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const [picks, setPicks] = useState<Picks>(initialPicks);
  const [saved, setSaved] = useState<Picks>(initialPicks);
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [active, setActive] = useState<Slot | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const builderRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(false);
  useEffect(() => {
    const el = summaryRef.current;
    if (!el) return;
    // Show the pinned bar only after the real one has scrolled up off screen.
    const io = new IntersectionObserver(([e]) => setDock(!e.isIntersecting && e.boundingClientRect.top < 0), {
      rootMargin: "-48px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // On phones and tablets the list sits below the team: jump between them.
  const stacked = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

  function chooseSlot(slot: Slot) {
    if (locked) return;
    if (active === slot) {
      setActive(null);
      return;
    }
    setActive(slot);
    setTab(slot === "team" ? "constructor" : "driver");
    if (stacked()) requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const [tab, setTab] = useState<"driver" | "constructor">("driver");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("price");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const locked = race.locked || (!!race.deadline && new Date(race.deadline).getTime() <= now);
  const price = teamPrice(picks, byId);
  const penalty = budgetPenalty(price, budget);
  const issues = lineupIssues(picks, byId, doubleCap);
  const badIds = new Set(issues.map((i) => ("assetId" in i ? i.assetId : "")));
  const dirty = SLOTS.some((s) => (picks[s] ?? null) !== (saved[s] ?? null));
  const inTeam = new Set(SLOTS.map((s) => picks[s]).filter(Boolean) as AssetId[]);
  const name = (id: AssetId) => byId.get(id)?.ticker ?? "?";

  function tap(a: TeamAsset) {
    if (locked) return;
    setError(null);
    const at = SLOTS.find((s) => picks[s] === a.id);
    if (at) {
      setPicks({ ...picks, [at]: null });
      return;
    }
    const slot = slotFor(a, picks, active, doubleCap);
    if (!slot) {
      setError(
        a.kind === "driver" && a.price >= doubleCap
          ? `All driver slots are full, and ${a.ticker} is too expensive for ×2. Remove a driver first.`
          : "That slot is full. Remove a pick first.",
      );
      return;
    }
    setPicks({ ...picks, [slot]: a.id });
    const cameFromSlot = active !== null;
    setActive(null);
    if (cameFromSlot && stacked()) {
      requestAnimationFrame(() => builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await saveTeam(race.id, picks);
      if (r.ok) {
        setSaved(picks);
        setSavedAt(r.savedAt);
        setNow(Date.now());
      } else setError(r.error);
    });
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = assets.filter(
      (a) =>
        a.kind === tab &&
        (!q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.team.toLowerCase().includes(q)),
    );
    const cmp: Record<SortKey, (a: TeamAsset, b: TeamAsset) => number> = {
      price: (a, b) => b.price - a.price,
      season: (a, b) => b.season - a.season,
      last3: (a, b) => b.last3 - a.last3,
      name: (a, b) => a.ticker.localeCompare(b.ticker),
    };
    return rows.sort((a, b) => cmp[sort](a, b) || a.ticker.localeCompare(b.ticker));
  }, [assets, tab, query, sort]);

  const deadline = race.deadline ? new Date(race.deadline) : null;

  return (
    <div className="grid gap-3 lg:grid-cols-[380px_1fr] lg:items-start">
      {/* ───────── Builder ───────── */}
      <section ref={builderRef} className="scroll-mt-14 rounded-lg border border-line bg-card lg:sticky lg:top-15">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line px-3 py-2">
          <h1 className="font-bold">
            {race.label} · {race.name}
          </h1>
          {race.isSprint && <span className="rounded bg-navy px-1.5 text-[11px] font-semibold text-white">SPRINT</span>}
          <span className="ml-auto text-xs text-muted" suppressHydrationWarning>
            {locked ? (
              <b className="text-red">Locked</b>
            ) : deadline ? (
              <>
                Deadline{" "}
                {deadline.toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · <b className="text-ink"><Countdown deadline={race.deadline!} /></b>
              </>
            ) : (
              "Deadline not set yet"
            )}
          </span>
        </div>

        <ul className="divide-y divide-line">
          {SLOTS.map((slot) => {
            const id = picks[slot];
            const a = id ? byId.get(id) : undefined;
            const on = active === slot;
            return (
              <li key={slot}>
                <div
                  role={locked ? undefined : "button"}
                  tabIndex={locked ? undefined : 0}
                  onClick={() => chooseSlot(slot)}
                  onKeyDown={(e) => e.key === "Enter" && chooseSlot(slot)}
                  className={`flex h-10 items-center gap-2 px-3 text-sm ${on ? "bg-red/10 outline-2 -outline-offset-2 outline-red" : ""} ${
                    locked ? "" : "cursor-pointer"
                  }`}
                >
                  <span className="w-11 shrink-0 text-xs font-bold text-muted">
                    {SLOT_LABEL[slot]}
                    {slot === "double" && <span className="ml-1 rounded bg-red px-1 text-[10px] text-white">×2</span>}
                  </span>
                  {a ? (
                    <>
                      <span className="h-5 w-1 shrink-0 rounded" style={{ background: a.colour }} />
                      <b className={badIds.has(a.id) ? "text-down" : ""}>{a.ticker}</b>
                      <span className="truncate text-muted">{a.kind === "driver" ? a.team : a.name}</span>
                      <span className="ml-auto">{fmt(a.price)}</span>
                      {!locked && (
                        <button
                          type="button"
                          aria-label={`Remove ${a.ticker}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPicks({ ...picks, [slot]: null });
                          }}
                          className="-mr-1 px-1 text-muted hover:text-down"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  ) : id ? (
                    <span className="text-down">No longer available: pick again</span>
                  ) : (
                    <span className="text-muted">
                      {locked ? "Empty" : on ? "Now tap an asset in the list" : `Empty · tap to choose${slot === "double" ? ` (under ${doubleCap})` : ""}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div ref={summaryRef}>
        {/* Cost bar */}
        <div className="border-t border-line px-3 py-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="whitespace-nowrap">
              Team <b>{fmt(price)}</b> <span className="text-muted">/ {budget}</span>
            </span>
            {penalty < 0 ? (
              <span className="font-semibold text-down">
                Over by {fmt(price - budget)} → −{Math.abs(penalty)} pts
                <span className="hidden sm:inline"> this race</span>
              </span>
            ) : (
              <span className="text-muted">{fmt(budget - price)} left</span>
            )}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-line">
            <div
              className={`h-full ${penalty < 0 ? "bg-down" : "bg-navy dark:bg-white/70"}`}
              style={{ width: `${Math.min(100, (price / budget) * 100)}%` }}
            />
          </div>
        </div>

        {(issues.length > 0 || error) && (
          <ul className="border-t border-line px-3 py-2 text-xs text-down">
            {issues.map((i, k) => (
              <li key={k}>{describeIssue(i, name, doubleCap)}</li>
            ))}
            {error && <li>{error}</li>}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          {origin && origin !== "manual" && !dirty && (
            <span className="rounded bg-black/10 px-1.5 text-[11px] font-semibold uppercase dark:bg-white/10">
              {origin === "random" ? "Random" : "Auto-filled"}
            </span>
          )}
          <span className="text-xs text-muted" suppressHydrationWarning>
            {locked
              ? savedAt
                ? "Your team for this race."
                : "You didn't save a team; one is picked for you at the lock."
              : dirty
                ? "Unsaved changes"
                : savedAt
                  ? `Saved ${ago(savedAt, now)}`
                  : "Not saved yet"}
            {!locked && SLOTS.some((s) => !picks[s]) && " · empty slots are auto-filled at the deadline"}
          </span>
          {!locked && (
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty || issues.length > 0}
              className="ml-auto rounded bg-red px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save team"}
            </button>
          )}
        </div>
        </div>
      </section>

      {/* Phones: once the price and Save button scroll out of view, keep a copy pinned above the tabs. */}
      {!locked && dock && (
        <div className="fixed inset-x-0 bottom-[calc(41px+env(safe-area-inset-bottom))] z-10 border-t border-line bg-card shadow-[0_-2px_8px_rgba(0,0,0,.08)] md:bottom-0 lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="whitespace-nowrap">
                  Team <b>{fmt(price)}</b> <span className="text-muted">/ {budget}</span>
                </span>
                {penalty < 0 ? (
                  <span className="truncate font-semibold text-down">−{Math.abs(penalty)} pts</span>
                ) : (
                  <span className="truncate text-muted">{fmt(budget - price)} left</span>
                )}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-line">
                <div
                  className={`h-full ${penalty < 0 ? "bg-down" : "bg-navy dark:bg-white/70"}`}
                  style={{ width: `${Math.min(100, (price / budget) * 100)}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty || issues.length > 0}
              className="shrink-0 rounded bg-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? "Saving…" : dirty ? "Save team" : "Saved"}
            </button>
          </div>
        </div>
      )}

      {/* ───────── Asset list ───────── */}
      {!locked && (
        <section ref={listRef} className="scroll-mt-14 rounded-lg border border-line bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-sm"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded border border-line bg-card px-1.5 py-1 text-sm"
              aria-label="Sort by"
            >
              <option value="price">Price</option>
              <option value="season">Season</option>
              <option value="last3">Last 3</option>
              <option value="name">Name</option>
            </select>
          </div>

          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pl-3 text-left font-semibold">{tab === "driver" ? "Driver" : "Constructor"}</th>
                <th className="px-2 text-right font-semibold">Season</th>
                <th className="px-2 text-right font-semibold">Last 3</th>
                <th className="pr-2 text-right font-semibold">Price</th>
                <th className="w-10 pr-2" aria-label="Add or remove" />
              </tr>
            </thead>
            {tab === "driver" ? (
              <>
                <Group
                  title={`Not eligible for ×2 (${doubleCap} and over)`}
                  rows={list.filter((a) => a.price >= doubleCap)}
                  inTeam={inTeam}
                  onTap={tap}
                />
                <Group title="Eligible for ×2" rows={list.filter((a) => a.price < doubleCap)} inTeam={inTeam} onTap={tap} />
              </>
            ) : (
              <Group rows={list} inTeam={inTeam} onTap={tap} />
            )}
          </table>
          {list.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nothing matches “{query}”.</p>}
        </section>
      )}
      {!locked && <div aria-hidden className="h-12 lg:hidden" />}
    </div>
  );
}

function Group({
  title,
  rows,
  inTeam,
  onTap,
}: {
  title?: string;
  rows: TeamAsset[];
  inTeam: Set<AssetId>;
  onTap: (a: TeamAsset) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <tbody>
      {title && (
        <tr>
          <th colSpan={5} className="bg-bg px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            {title}
          </th>
        </tr>
      )}
      {rows.map((a) => {
        const picked = inTeam.has(a.id);
        return (
          <tr
            key={a.id}
            onClick={() => onTap(a)}
            className={`cursor-pointer border-t border-line ${picked ? "bg-red/5" : "hover:bg-black/[.03] dark:hover:bg-white/[.04]"}`}
          >
            <td className="py-1.5 pl-3">
              <div className="flex items-center gap-2">
                <span className="h-6 w-1 shrink-0 rounded" style={{ background: a.colour }} />
                <span className="min-w-0">
                  <b>{a.ticker}</b>
                  <span className="hidden text-muted sm:inline">
                    {" "}
                    {a.name}
                    {a.kind === "driver" && ` · ${a.team}`}
                  </span>
                </span>
              </div>
            </td>
            <td className={`px-2 text-right ${a.season < 0 ? "text-down" : ""}`}>
              {pts(a.season)}
            </td>
            <td className={`px-2 text-right ${a.last3 < 0 ? "text-down" : ""}`}>
              {pts(a.last3)}
            </td>
            <td className="pr-2 text-right whitespace-nowrap">
              {fmt(a.price)}
              {a.move != null && a.move !== 0 && (
                <span className={`ml-1 hidden text-[11px] min-[360px]:inline ${a.move > 0 ? "text-up" : "text-down"}`}>
                  {a.move > 0 ? "▲" : "▼"}
                  {Math.abs(a.move).toFixed(2)}
                </span>
              )}
            </td>
            <td className="py-1 pr-2">
              <button
                type="button"
                aria-label={picked ? `Remove ${a.ticker}` : `Add ${a.ticker}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onTap(a);
                }}
                className={`grid h-8 w-8 place-items-center rounded text-lg font-bold leading-none text-white ${
                  picked ? "bg-muted" : "bg-navy dark:bg-white/20"
                }`}
              >
                {picked ? "−" : "+"}
              </button>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}
