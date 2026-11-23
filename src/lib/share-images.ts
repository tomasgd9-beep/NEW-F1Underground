// The four images players paste into the group chat (and the graph in the recap email):
// Highlights, Race results, Season standings and the Season graph. Laid out with
// satori (HTML/CSS → SVG) and turned into a PNG with resvg, at twice the size for
// sharp text on phones. The font files live in assets/fonts (Titillium Web, OFL).
import { createElement, type CSSProperties, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { PALETTE } from "@/lib/palette";
import { lockTime, type Recap, type RecapChip } from "@/lib/recap";

export const SHARE_KINDS = ["highlights", "race", "season", "graph"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

const C = {
  navy: "#15151e",
  red: "#e10600",
  bg: "#f6f4f1",
  card: "#ffffff",
  line: "#e4e0da",
  ink: "#15151e",
  muted: "#6b6b76",
  up: "#1f6feb",
  down: "#e10600",
  chip: "#f1efeb",
};
const MEDAL = ["#d4a017", "#9aa0a6", "#b0703c"];

type Kids = ReactNode | ReactNode[];
/** A flex box (satori needs display:flex on anything with several children). */
const box = (style: CSSProperties, ...children: Kids[]) =>
  createElement("div", { style: { display: "flex", ...style } }, ...children);
const text = (style: CSSProperties, s: string | number) => createElement("div", { style: { display: "flex", ...style } }, String(s));

const fmt = (v: number) => (v < 0 ? "−" : "") + (Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1));
const signed = (v: number) => (v > 0 ? `+${fmt(v)}` : v === 0 ? "0" : `−${fmt(-v)}`);

let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | undefined;
function loadFonts() {
  fonts ??= ([400, 600, 700] as const).map((w) => ({
    name: "Titillium Web",
    data: readFileSync(path.join(process.cwd(), "assets/fonts", `titillium-web-latin-${w}-normal.woff`)),
    weight: w,
    style: "normal" as const,
  }));
  return fonts;
}

/** satori → SVG → PNG at 2× (so a 540-wide card is 1080 pixels wide). */
export async function renderPng(node: ReactNode, width: number, height: number): Promise<Buffer> {
  const svg = await satori(node as Parameters<typeof satori>[0], { width, height, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "zoom", value: 2 } }).render().asPng());
}

/* ───────────────────────── Shared pieces ───────────────────────── */

const HEADER = 56;
function frame(width: number, height: number, recap: Recap, subtitle: string, body: Kids) {
  const state = recap.race.results === "final" ? "Final" : recap.race.results === "none" ? "Locked" : "Provisional";
  return box(
    { width, height, flexDirection: "column", background: C.bg, fontFamily: "Titillium Web", color: C.ink },
    box(
      { height: HEADER, background: C.navy, alignItems: "center", padding: "0 24px", color: "#fff" },
      box({ fontSize: 22, fontWeight: 700 }, text({ color: C.red, marginRight: 6 }, "F1"), "Underground"),
      text({ marginLeft: "auto", fontSize: 15, color: "rgba(255,255,255,0.75)", fontWeight: 600 }, `${recap.race.label} · ${state.toUpperCase()}`),
    ),
    box(
      { flexDirection: "column", padding: "16px 24px 0" },
      text({ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }, recap.race.name),
      text({ fontSize: 14, color: C.muted, marginTop: 2 }, subtitle),
    ),
    box({ flexDirection: "column", flexGrow: 1, padding: "12px 24px 20px" }, body),
  );
}

/** ▲2 / ▼1 as a drawn triangle (the font has no arrow glyphs). */
function move(m: number | null) {
  if (!m) return text({ color: C.muted, fontSize: 14 }, "–");
  const upward = m > 0;
  const col = upward ? C.up : C.down;
  return box(
    { alignItems: "center", color: col, fontSize: 14, fontWeight: 700 },
    createElement(
      "svg",
      { width: 10, height: 9, viewBox: "0 0 10 9", style: { marginRight: 2 } },
      createElement("path", { d: upward ? "M5 0 L10 9 L0 9 Z" : "M0 0 L10 0 L5 9 Z", fill: col }),
    ),
    String(Math.abs(m)),
  );
}

function chip(c: RecapChip, width: number) {
  return box(
    {
      width,
      height: 28,
      alignItems: "center",
      justifyContent: "space-between",
      background: C.chip,
      borderLeft: `3px solid ${c.colour}`,
      borderRadius: 3,
      padding: "0 6px",
      fontSize: 13,
    },
    box(
      { alignItems: "center", fontWeight: 700 },
      c.ticker,
      c.slot === "x2" ? text({ color: C.red, fontSize: 10, marginLeft: 2 }, "×2") : null,
    ),
    text({ color: c.v < 0 ? C.down : C.ink }, fmt(c.v)),
  );
}

/* ───────────────────────── Highlights ───────────────────────── */

function highlights(recap: Recap) {
  const W = 540;
  const pod = recap.podium.slice(0, 6);
  const podRows = Math.ceil(pod.length / 3);
  const H = HEADER + 70 + 12 + podRows * 104 + recap.highlights.length * 62 + (recap.next ? 74 : 0) + 24;
  const body = [
    box(
      { flexWrap: "wrap", gap: 8, marginBottom: 6 },
      ...pod.map((r) =>
        box(
          {
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 120,
            height: 96,
            flexDirection: "column",
            background: C.card,
            border: `1px solid ${C.line}`,
            borderTop: `5px solid ${MEDAL[r.rank - 1] ?? C.muted}`,
            borderRadius: 6,
            padding: "8px 10px",
          },
          text({ fontSize: 13, color: C.muted, fontWeight: 700 }, `P${r.rank}`),
          text({ fontSize: 19, fontWeight: 700, lineHeight: 1.1 }, r.name),
          text({ fontSize: 26, fontWeight: 700, color: C.ink, marginTop: "auto", lineHeight: 1 }, fmt(r.total)),
        ),
      ),
    ),
    ...recap.highlights.map((h) =>
      box(
        {
          height: 54,
          marginTop: 8,
          flexDirection: "column",
          justifyContent: "center",
          background: C.card,
          borderLeft: `4px solid ${h.key === "flop" ? C.down : h.key === "pick" || h.key === "solo" ? "#16a34a" : C.up}`,
          borderRadius: 4,
          padding: "0 12px",
        },
        text({ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.5 }, h.label.toUpperCase()),
        box(
          { alignItems: "baseline", fontSize: 17, fontWeight: 700, lineHeight: 1.15 },
          h.text,
          h.detail ? text({ fontSize: 13, color: C.muted, fontWeight: 400, marginLeft: 8 }, h.detail) : null,
        ),
      ),
    ),
    recap.next
      ? box(
          {
            marginTop: 12,
            height: 62,
            flexDirection: "column",
            justifyContent: "center",
            background: C.navy,
            color: "#fff",
            borderRadius: 6,
            padding: "0 12px",
          },
          text(
            { fontSize: 15, fontWeight: 700 },
            `Next: ${recap.next.label} · ${recap.next.name}${recap.next.isSprint ? " · sprint weekend" : ""}`,
          ),
          text(
            { fontSize: 13, color: "rgba(255,255,255,0.75)" },
            recap.next.deadline
              ? `Teams lock ${lockTime(recap.next.deadline)}${recap.next.isSprint ? " (before the sprint)" : ""}`
              : "Deadline to be confirmed",
          ),
        )
      : null,
  ];
  return { node: frame(W, H, recap, "Weekend highlights", body), W, H };
}

/* ───────────────────────── Race results ───────────────────────── */

function raceTable(recap: Recap) {
  const ROW = 38;
  const chipW = 84;
  const W = 24 + 28 + 200 + 56 + 16 + 6 * (chipW + 4) + 20;
  const H = HEADER + 70 + 24 + recap.raceRows.length * ROW + 24;
  const rows = recap.raceRows.map((r, i) =>
    box(
      {
        height: ROW,
        alignItems: "center",
        background: i % 2 ? C.bg : C.card,
        borderLeft: `4px solid ${r.rank <= 3 ? MEDAL[r.rank - 1] : "transparent"}`,
        padding: "0 0 0 6px",
      },
      text({ width: 24, fontSize: 15, fontWeight: 700, color: C.muted }, r.rank),
      box(
        { width: 200, alignItems: "center", fontSize: 16, fontWeight: 600, overflow: "hidden" },
        r.name,
        r.origin !== "manual"
          ? text(
              { fontSize: 9, fontWeight: 700, background: "#e2e0dc", borderRadius: 3, padding: "1px 4px", marginLeft: 5 },
              r.origin === "random" ? "RANDOM" : "AUTO",
            )
          : null,
        r.penalty < 0 ? text({ fontSize: 11, fontWeight: 700, color: C.down, marginLeft: 5 }, fmt(r.penalty)) : null,
      ),
      text({ width: 56, fontSize: 18, fontWeight: 700, justifyContent: "flex-end", color: r.total < 0 ? C.down : C.ink }, fmt(r.total)),
      box(
        { marginLeft: 16, gap: 4 },
        ...r.chips.map((c, j) =>
          // The constructor always sits in the last column, even when a slot is empty.
          box({ marginLeft: c.slot === "c" && j < 5 ? (5 - j) * (chipW + 4) : 0 }, chip(c, chipW)),
        ),
      ),
    ),
  );
  const head = box(
    { height: 24, alignItems: "center", fontSize: 12, color: C.muted, fontWeight: 700, padding: "0 0 0 10px" },
    text({ width: 24 }, "#"),
    text({ width: 200 }, "Player"),
    text({ width: 56, justifyContent: "flex-end" }, "Pts"),
    text({ marginLeft: 16 }, "×2 first, then drivers by points, then the constructor"),
  );
  return {
    node: frame(W, H, recap, "Race results", [box({ flexDirection: "column", border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", background: C.card }, head, ...rows)]),
    W,
    H,
  };
}

/* ───────────────────────── Season standings ───────────────────────── */

function seasonTable(recap: Recap) {
  const ROW = 34;
  const W = 540;
  const H = HEADER + 70 + 26 + recap.season.length * ROW + 24;
  const cols = { rank: 30, move: 40, total: 70, gap: 64, last: 66 };
  const head = box(
    { height: 26, alignItems: "center", fontSize: 12, color: C.muted, fontWeight: 700, padding: "0 10px" },
    text({ width: cols.rank }, "#"),
    text({ width: cols.move }, "±"),
    text({ flexGrow: 1 }, "Player"),
    text({ width: cols.total, justifyContent: "flex-end" }, "Total"),
    text({ width: cols.gap, justifyContent: "flex-end" }, "Gap"),
    text({ width: cols.last, justifyContent: "flex-end" }, recap.race.label.split(" ")[1] ?? "Race"),
  );
  const rows = recap.season.map((s, i) =>
    box(
      { height: ROW, alignItems: "center", background: i % 2 ? C.bg : C.card, padding: "0 10px", fontSize: 16 },
      text({ width: cols.rank, fontWeight: 700, color: C.muted }, s.rank),
      box({ width: cols.move }, move(s.move)),
      text({ flexGrow: 1, fontWeight: 600 }, s.name),
      text({ width: cols.total, justifyContent: "flex-end", fontWeight: 700 }, fmt(s.total)),
      text({ width: cols.gap, justifyContent: "flex-end", color: C.muted }, s.gapAbove == null ? "" : `−${fmt(s.gapAbove)}`),
      text({ width: cols.last, justifyContent: "flex-end", color: (s.lastRace ?? 0) < 0 ? C.down : C.ink }, s.lastRace == null ? "–" : fmt(s.lastRace)),
    ),
  );
  return {
    node: frame(W, H, recap, `Season standings after ${recap.races.length} race${recap.races.length === 1 ? "" : "s"} · gap to the player above`, [
      box({ flexDirection: "column", border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", background: C.card }, head, ...rows),
    ]),
    W,
    H,
  };
}

/* ───────────────────────── Season graph ───────────────────────── */

function seasonGraph(recap: Recap) {
  const W = 720;
  const CW = W - 48; // chart box width
  const CH = 300;
  const L = 46, R = 22, T = 10, B = 22;
  const g = recap.graph;
  const n = g.labels.length;
  const all = g.series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all) || 1;
  const X = (i: number) => L + (n <= 1 ? (CW - L - R) / 2 : (i / (n - 1)) * (CW - L - R));
  const Y = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (CH - T - B);
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(1, hi - lo))));
  const unit = (hi - lo) / step > 5 ? step : step / 2;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / unit) * unit; t <= hi; t += unit) ticks.push(Math.round(t));

  const colour = (i: number) => PALETTE[i % PALETTE.length];
  const lines = g.series.map((s, i) =>
    createElement(
      "g",
      { key: s.playerId },
      createElement("polyline", {
        fill: "none",
        stroke: colour(i),
        strokeWidth: i === 0 ? 3 : 2,
        points: s.values.map((v, k) => `${X(k)},${Y(v)}`).join(" "),
      }),
      ...s.values.map((v, k) => createElement("circle", { key: k, cx: X(k), cy: Y(v), r: 2.5, fill: colour(i) })),
    ),
  );
  const grid = ticks.map((t) =>
    createElement("line", { key: `t${t}`, x1: L, x2: CW - R, y1: Y(t), y2: Y(t), stroke: t === 0 ? C.muted : C.line, strokeDasharray: t === 0 ? "4 3" : undefined }),
  );
  const svg = createElement("svg", { width: CW, height: CH, viewBox: `0 0 ${CW} ${CH}` }, ...grid, ...lines);
  // Axis labels as positioned text (text inside the SVG wouldn't get the font).
  const yLabels = ticks.map((t) =>
    text({ position: "absolute", left: 0, width: L - 6, top: Y(t) - 9, fontSize: 11, color: C.muted, justifyContent: "flex-end" }, fmt(t)),
  );
  const xEvery = Math.max(1, Math.ceil(n / 8));
  const xLabels = g.labels
    .map((l, k) =>
      k % xEvery === 0 || k === n - 1
        ? text({ position: "absolute", top: CH - 18, left: X(k) - 24, width: 48, justifyContent: "center", fontSize: 10, color: C.muted }, l.split(" ")[1] ?? l)
        : null,
    )
    .filter(Boolean);

  const half = Math.ceil(g.series.length / 2);
  const legendCol = (part: typeof g.series, offset: number) =>
    box(
      { flexDirection: "column", width: (CW - 24) / 2 },
      ...part.map((s, k) => {
        const row = recap.season.find((x) => x.playerId === s.playerId)!;
        return box(
          { height: 24, alignItems: "center", fontSize: 14 },
          box({ width: 10, height: 10, borderRadius: 5, background: colour(offset + k), marginRight: 6 }),
          text({ width: 22, color: C.muted, fontWeight: 700 }, row.rank),
          text({ flexGrow: 1, fontWeight: 600 }, s.name),
          text({ width: 56, justifyContent: "flex-end", fontWeight: 700 }, fmt(row.total)),
          text({ width: 56, justifyContent: "flex-end", color: row.gapLeader ? C.down : C.muted }, row.gapLeader ? signed(-row.gapLeader) : "–"),
        );
      }),
    );
  const legendH = half * 24;
  const H = HEADER + 70 + CH + 16 + 20 + legendH + 30;
  const leader = recap.season[0]?.name ?? "";
  const body = [
    box({ position: "relative", width: CW, height: CH, background: C.card, borderRadius: 6 }, svg, ...yLabels, ...xLabels),
    box(
      { marginTop: 12, height: 20, fontSize: 12, color: C.muted, fontWeight: 700 },
      text({ width: (CW - 24) / 2 }, "PLAYER · POINTS · GAP TO 1ST"),
      text({ marginLeft: 24 }, ""),
    ),
    box({ gap: 24 }, legendCol(g.series.slice(0, half), 0), legendCol(g.series.slice(half), half)),
  ];
  return { node: frame(W, H, recap, `Season graph · gap to the leader (${leader}) after each race`, body), W, H };
}

export async function shareImage(kind: ShareKind, recap: Recap): Promise<Buffer> {
  const { node, W, H } =
    kind === "highlights" ? highlights(recap) : kind === "race" ? raceTable(recap) : kind === "season" ? seasonTable(recap) : seasonGraph(recap);
  return renderPng(node, W, H);
}

export function shareFileName(kind: ShareKind, recap: Recap) {
  return `f1-underground-${recap.race.label.toLowerCase().replace(/\s+/g, "-")}-${kind}.png`;
}
