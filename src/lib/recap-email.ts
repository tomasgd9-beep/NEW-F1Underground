// The weekend recap email. The scheduled job sends it by itself once a race's results
// are final (a commissioner can preview it, send a test, or resend from Admin).
// Everything (podium, highlights, race and season tables, graph, next race)
// comes from the League data. Tables are real HTML so they stay sharp and readable
// with images blocked; only the graph is an image (attached inline).
import { and, desc, eq, gt, gte, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { assetPrices, leagues, people, players, races, recaps, seasons } from "@/db/schema";
import { logActivity } from "@/lib/league";
import { loadLeague } from "@/lib/league-data";
import { appUrl, escapeHtml, sendMail } from "@/lib/mail";
import { alreadySent, claim, deliver, ordinal, recipients, type Recipient } from "@/lib/notify";
import { buildRecap, lockTime, type Recap } from "@/lib/recap";
import { shareImage } from "@/lib/share-images";
import { unsubscribeParts } from "@/lib/email-prefs";

const fmt = (v: number) => (v < 0 ? "−" : "") + (Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1));
const esc = escapeHtml;
const GRAPH_CID = "season-graph@f1underground";

export type RecapExtras = {
  leagueName: string;
  note: string;
  author: string;
  /** Drivers too expensive to be ×2 at the next race. */
  noX2: string[];
};

/** Everything the email needs, from the database. Null if the race isn't locked or has no teams. */
export async function loadRecap(db: Db, leagueId: number, raceId: number) {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race) return null;
  const [anyPlayer] = await db.select({ id: players.id }).from(players).where(eq(players.leagueId, leagueId)).limit(1);
  const data = await loadLeague(db, leagueId, anyPlayer?.id ?? 0, race.seasonId);
  const recap = data && buildRecap(data, raceId);
  if (!recap || !recap.raceRows.length) return null;

  let noX2: string[] = [];
  if (recap.next) {
    const [season] = await db.select({ cap: seasons.doubleCap }).from(seasons).where(eq(seasons.id, race.seasonId));
    noX2 = (
      await db
        .select({ ticker: people.ticker, price: assetPrices.finalPrice })
        .from(assetPrices)
        .innerJoin(people, eq(people.id, assetPrices.personId))
        .where(
          and(
            eq(assetPrices.raceId, recap.next.id),
            isNotNull(assetPrices.personId),
            gte(assetPrices.finalPrice, String(season?.cap ?? 20)),
          ),
        )
        .orderBy(desc(assetPrices.finalPrice))
    ).map((r) => r.ticker);
  }
  const [league] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  return { recap, noX2, leagueName: league?.name ?? "F1 Underground" };
}

export function recapSubject(recap: Recap) {
  const winners = recap.podium.filter((r) => r.rank === 1).map((r) => r.name);
  const lead = `${recap.race.label} recap: ${winners.join(" and ")} win${winners.length > 1 ? "" : "s"} with ${fmt(recap.podium[0]?.total ?? 0)}`;
  // The closest fight in the season table, if it's tight.
  let pair: [string, string, number] | null = null;
  for (let i = 1; i < recap.season.length; i++) {
    const g = recap.season[i].gapAbove ?? Infinity;
    if (!pair || g < pair[2]) pair = [recap.season[i - 1].name, recap.season[i].name, g];
  }
  return pair && pair[2] <= 25 && recap.races.length > 1
    ? `${lead} · ${pair[0]} and ${pair[1]} ${fmt(pair[2])} point${pair[2] === 1 ? "" : "s"} apart`
    : lead;
}

/** One person's copy: their own line, then the shared recap. */
export function recapEmail(recap: Recap, x: RecapExtras, me: { name: string; playerId: number } | null) {
  const url = appUrl();
  const mineRace = me && recap.raceRows.find((r) => r.playerId === me.playerId);
  const mineSeason = me && recap.season.find((s) => s.playerId === me.playerId);
  const personal = me
    ? [
        mineRace
          ? `You scored ${fmt(mineRace.total)} (${ordinal(mineRace.rank)} of ${recap.raceRows.length} this race).`
          : "You didn't have a team this race.",
        mineSeason
          ? `Season: ${ordinal(mineSeason.rank)}${mineSeason.move ? (mineSeason.move > 0 ? ` (up ${mineSeason.move})` : ` (down ${-mineSeason.move})`) : ""}, ${fmt(mineSeason.total)} points${mineSeason.gapLeader ? `, ${fmt(mineSeason.gapLeader)} behind 1st` : ""}.`
          : "",
      ].filter(Boolean)
    : [];

  /* ---------- text version ---------- */
  const t: string[] = [];
  if (me) t.push(`Hi ${me.name},`, "");
  if (x.note.trim()) t.push(x.note.trim(), `— ${x.author}`, "");
  if (personal.length) t.push(...personal, "");
  t.push(`${recap.race.name.toUpperCase()}`);
  t.push(recap.podium.map((p) => `P${p.rank} ${p.name} ${fmt(p.total)}`).join(" · "), "");
  for (const h of recap.highlights) t.push(`${h.label}: ${h.text}${h.detail ? ` (${h.detail})` : ""}`);
  t.push("", "RACE");
  for (const r of recap.raceRows) {
    t.push(
      `${r.rank}. ${r.name} ${fmt(r.total)}${r.origin === "random" ? " (random)" : ""}${r.penalty < 0 ? ` (penalty ${fmt(r.penalty)})` : ""}: ` +
        r.chips.map((c) => `${c.ticker}${c.slot === "x2" ? "×2" : ""} ${fmt(c.v)}`).join(", "),
    );
  }
  t.push("", "SEASON");
  for (const s of recap.season) {
    const mv = s.move ? (s.move > 0 ? ` ▲${s.move}` : ` ▼${-s.move}`) : "";
    t.push(`${s.rank}.${mv} ${s.name} ${fmt(s.total)}${s.gapAbove != null ? ` (−${fmt(s.gapAbove)})` : ""}`);
  }
  if (recap.next) {
    t.push("", `NEXT: ${recap.next.label} · ${recap.next.name}${recap.next.isSprint ? " · sprint weekend" : ""}`);
    if (recap.next.deadline) t.push(`Teams lock ${lockTime(recap.next.deadline)}${recap.next.isSprint ? " (before the sprint)" : ""}.`);
    if (x.noX2.length) t.push(`Can't be ×2 (20M or more): ${x.noX2.join(", ")}.`);
    t.push(`Build your team: ${url}/team`);
  }
  t.push("", `Everything on the League page: ${url}/league`);

  /* ---------- HTML version ---------- */
  const cell = "padding:4px 6px;border-top:1px solid #e4e0da;";
  const th = "padding:4px 6px;text-align:left;font-size:12px;color:#6b6b76;font-weight:600;";
  const h2 = (s: string) => `<h2 style="font-size:15px;margin:22px 0 6px">${esc(s)}</h2>`;
  const medal = ["#d4a017", "#9aa0a6", "#b0703c"];
  const red = (v: number) => (v < 0 ? "color:#e10600;" : "");

  const html: string[] = [];
  html.push(`<div style="font-family:'Titillium Web',Segoe UI,Helvetica,Arial,sans-serif;color:#15151e;max-width:640px;margin:0 auto">`);
  html.push(
    `<div style="background:#15151e;color:#fff;padding:10px 14px;border-radius:6px 6px 0 0;font-weight:700;font-size:17px"><span style="color:#e10600">F1</span> Underground <span style="float:right;font-weight:600;font-size:13px;opacity:.75">${esc(recap.race.label)}</span></div>`,
  );
  html.push(`<div style="padding:4px 2px">`);
  if (me) html.push(`<p>Hi ${esc(me.name)},</p>`);
  if (x.note.trim()) {
    html.push(
      `<div style="border-left:4px solid #e10600;background:#f6f4f1;padding:8px 12px;margin:10px 0;white-space:pre-wrap">${esc(x.note.trim())}<div style="margin-top:6px;color:#6b6b76">— ${esc(x.author)}</div></div>`,
    );
  }
  if (personal.length) html.push(`<p style="font-weight:600">${personal.map(esc).join("<br>")}</p>`);

  // Highlights
  html.push(`<h1 style="font-size:20px;margin:18px 0 6px">${esc(recap.race.name)}</h1>`);
  html.push(
    `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px"><tr>` +
      recap.podium
        .slice(0, 3)
        .map(
          (p) =>
            `<td style="width:33%;border:1px solid #e4e0da;border-top:4px solid ${medal[p.rank - 1] ?? "#6b6b76"};border-radius:6px;padding:6px 8px;vertical-align:top"><div style="font-size:12px;color:#6b6b76;font-weight:700">P${p.rank}</div><div style="font-weight:700;font-size:16px">${esc(p.name)}</div><div style="font-weight:700;font-size:22px">${fmt(p.total)}</div></td>`,
        )
        .join("") +
      `</tr></table>`,
  );
  html.push(`<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px">`);
  for (const h of recap.highlights) {
    const bar = h.key === "flop" ? "#e10600" : h.key === "pick" || h.key === "solo" ? "#16a34a" : "#1f6feb";
    html.push(
      `<tr><td style="border-left:4px solid ${bar};padding:5px 10px;border-bottom:6px solid #fff;background:#f6f4f1"><div style="font-size:11px;font-weight:700;color:#6b6b76;letter-spacing:.5px">${esc(h.label.toUpperCase())}</div><div style="font-weight:700">${esc(h.text)}${h.detail ? ` <span style="font-weight:400;color:#6b6b76">${esc(h.detail)}</span>` : ""}</div></td></tr>`,
    );
  }
  html.push(`</table>`);

  // Race table
  html.push(h2("Race results"));
  html.push(`<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="${th}">#</th><th style="${th}">Player</th><th style="${th}text-align:right">Pts</th></tr>`);
  for (const r of recap.raceRows) {
    const picks = r.chips
      .map(
        (c) =>
          `<span style="white-space:nowrap;border-left:3px solid ${c.colour};padding:0 4px;margin-right:2px"><b>${esc(c.ticker)}</b>${c.slot === "x2" ? `<b style="color:#e10600;font-size:10px">×2</b>` : ""} <span style="${red(c.v)}">${fmt(c.v)}</span></span>`,
      )
      .join(" ");
    const tag =
      (r.origin !== "manual" ? ` <span style="font-size:10px;background:#e2e0dc;border-radius:3px;padding:0 4px">${r.origin === "random" ? "RANDOM" : "AUTO"}</span>` : "") +
      (r.penalty < 0 ? ` <span style="font-size:11px;color:#e10600;font-weight:700">${fmt(r.penalty)}</span>` : "");
    const me2 = me && r.playerId === me.playerId ? "background:#fdecec;" : "";
    html.push(
      `<tr style="${me2}"><td style="${cell}color:#6b6b76;font-weight:700;vertical-align:top;border-left:3px solid ${r.rank <= 3 ? medal[r.rank - 1] : "transparent"}">${r.rank}</td><td style="${cell}"><b>${esc(r.name)}</b>${tag}<div style="font-size:12px;line-height:1.7;margin-top:2px">${picks}</div></td><td style="${cell}text-align:right;font-weight:700;vertical-align:top;${red(r.total)}">${fmt(r.total)}</td></tr>`,
    );
  }
  html.push(`</table>`);

  // Season table
  html.push(h2(`Season after ${recap.races.length} race${recap.races.length === 1 ? "" : "s"}`));
  html.push(
    `<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="${th}">#</th><th style="${th}">±</th><th style="${th}">Player</th><th style="${th}text-align:right">Total</th><th style="${th}text-align:right">Gap</th><th style="${th}text-align:right">${esc(recap.race.label.split(" ")[1] ?? "Race")}</th></tr>`,
  );
  for (const s of recap.season) {
    const mv = s.move
      ? `<span style="color:${s.move > 0 ? "#1f6feb" : "#e10600"};font-weight:700">${s.move > 0 ? "▲" : "▼"}${Math.abs(s.move)}</span>`
      : `<span style="color:#6b6b76">–</span>`;
    const me2 = me && s.playerId === me.playerId ? "background:#fdecec;" : "";
    html.push(
      `<tr style="${me2}"><td style="${cell}color:#6b6b76;font-weight:700">${s.rank}</td><td style="${cell}font-size:12px">${mv}</td><td style="${cell}font-weight:600">${esc(s.name)}</td><td style="${cell}text-align:right;font-weight:700">${fmt(s.total)}</td><td style="${cell}text-align:right;color:#6b6b76">${s.gapAbove != null ? `−${fmt(s.gapAbove)}` : ""}</td><td style="${cell}text-align:right;${red(s.lastRace ?? 0)}">${s.lastRace == null ? "–" : fmt(s.lastRace)}</td></tr>`,
    );
  }
  html.push(`</table>`);
  if (recap.races.length > 1) {
    html.push(`<img src="cid:${GRAPH_CID}" alt="Season graph: gap to the leader after each race" width="640" style="width:100%;max-width:640px;height:auto;margin-top:12px;border-radius:6px">`);
  }

  // Next race
  if (recap.next) {
    const n = recap.next;
    html.push(
      `<div style="background:#15151e;color:#fff;border-radius:6px;padding:10px 14px;margin-top:20px">` +
        `<div style="font-weight:700;font-size:16px">Next: ${esc(n.label)} · ${esc(n.name)}${n.isSprint ? " · sprint weekend" : ""}</div>` +
        (n.deadline ? `<div style="opacity:.8">Teams lock <b>${esc(lockTime(n.deadline))}</b>${n.isSprint ? " (before the sprint)" : ""}</div>` : "") +
        (x.noX2.length ? `<div style="opacity:.8">Can't be ×2 (20M or more): ${esc(x.noX2.join(", "))}</div>` : "") +
        `<a href="${url}/team" style="display:inline-block;margin-top:8px;background:#e10600;color:#fff;text-decoration:none;font-weight:700;padding:6px 12px;border-radius:4px">Build my team</a></div>`,
    );
  }
  html.push(`<p><a href="${url}/league">Everything on the League page</a></p>`);
  html.push(`</div></div>`);

  return { subject: recapSubject(recap), text: t.join("\n") + "\n", html: html.join("") };
}

export async function recapGraph(recap: Recap) {
  return recap.races.length > 1 ? await shareImage("graph", recap) : null;
}

const graphAttachment = (png: Buffer | null) =>
  png ? [{ filename: "season-graph.png", content: png, cid: GRAPH_CID, contentType: "image/png" }] : [];

/** The note a commissioner saved for a race (and whether the recap went out). */
export async function getRecapRow(db: Db, leagueId: number, raceId: number) {
  const [row] = await db
    .select()
    .from(recaps)
    .where(and(eq(recaps.leagueId, leagueId), eq(recaps.raceId, raceId)));
  return row ?? null;
}

export async function saveRecapNote(db: Db, leagueId: number, raceId: number, note: string) {
  await db
    .insert(recaps)
    .values({ leagueId, raceId, note })
    .onConflictDoUpdate({ target: [recaps.leagueId, recaps.raceId], set: { note, updatedAt: new Date() } });
}

/** A test copy to one address (nothing recorded, settings ignored). */
export async function sendRecapTest(db: Db, leagueId: number, raceId: number, note: string, author: string, to: { email: string; name: string; playerId: number; userId?: string }) {
  const loaded = await loadRecap(db, leagueId, raceId);
  if (!loaded) throw new Error("No recap for that race yet: teams have to be locked and scored.");
  const mail = recapEmail(loaded.recap, { ...loaded, note, author }, to);
  // The real footer (your own links), so the test shows exactly what players get.
  const foot = to.userId ? await unsubscribeParts(db, to.userId, "recaps") : { text: "", html: "", extras: {} };
  await sendMail(to.email, `[Test] ${mail.subject}`, mail.text + foot.text, mail.html + foot.html, {
    ...foot.extras,
    attachments: graphAttachment(await recapGraph(loaded.recap)),
  });
}

/**
 * The recap to everyone in the league whose settings allow it, once each (running it
 * again only reaches people who didn't get it yet). Returns how many were sent.
 */
export async function sendRecapToAll(db: Db, leagueId: number, raceId: number, note: string, author: string, actorUserId: string) {
  const people = (await recipients(db, "recaps")).filter((r: Recipient) => r.leagueId === leagueId);
  // Nobody left to send to: stop before the (slow) data load and graph.
  const todo = [];
  for (const r of people) if (!(await alreadySent(db, r.playerId, raceId, "recap"))) todo.push(r);
  if (!todo.length) return { sent: 0, failed: [] as string[], skipped: people.length };
  const loaded = await loadRecap(db, leagueId, raceId);
  if (!loaded) throw new Error("No recap for that race yet: teams have to be locked and scored.");
  await saveRecapNote(db, leagueId, raceId, note);
  const png = await recapGraph(loaded.recap);
  let sent = 0;
  const failed: string[] = [];
  for (const r of todo) {
    if (!(await claim(db, r.playerId, raceId, "recap"))) continue;
    const mail = recapEmail(loaded.recap, { ...loaded, note, author }, { name: r.name, playerId: r.playerId });
    const foot = await unsubscribeParts(db, r.userId, "recaps");
    try {
      await deliver(db, r.playerId, raceId, "recap", () =>
        sendMail(r.email, mail.subject, mail.text + foot.text, mail.html + foot.html, {
          ...foot.extras,
          attachments: graphAttachment(png),
        }),
      );
      sent++;
    } catch {
      failed.push(r.name);
    }
  }
  if (!sent && !failed.length) return { sent, failed, skipped: people.length };
  const row = await getRecapRow(db, leagueId, raceId);
  await db
    .update(recaps)
    .set({ sentAt: new Date(), sentBy: actorUserId, sentCount: (row?.sentCount ?? 0) + sent })
    .where(and(eq(recaps.leagueId, leagueId), eq(recaps.raceId, raceId)));
  await logActivity(db, actorUserId, "recap_sent", { race: loaded.recap.race.label, sent, failed }, { leagueId });
  return { sent, failed, skipped: people.length - sent - failed.length };
}

/** An announcement from a commissioner to everyone whose settings allow it. */
export async function sendAnnouncement(db: Db, leagueId: number, subject: string, body: string, author: string, actorUserId: string) {
  const people = (await recipients(db, "announcements")).filter((r) => r.leagueId === leagueId);
  let sent = 0;
  for (const r of people) {
    const foot = await unsubscribeParts(db, r.userId, "announcements");
    await sendMail(
      r.email,
      `F1 Underground: ${subject}`,
      `Hi ${r.name},\n\n${body}\n\n— ${author}\n${foot.text}`,
      `<p>Hi ${esc(r.name)},</p><div style="white-space:pre-wrap">${esc(body)}</div><p style="color:#6b6b76">— ${esc(author)}</p>${foot.html}`,
      foot.extras,
    );
    sent++;
  }
  await logActivity(db, actorUserId, "announcement_sent", { subject, sent }, { leagueId });
  return sent;
}

/**
 * The job's part: once a race's results are final, everyone gets the recap. Only races
 * from the last 4 days (imported history never triggers it), and not races marked skipAuto.
 */
export async function sendAutoRecaps(db: Db, now = new Date()) {
  const finals = await db
    .select({ id: races.id, label: races.label })
    .from(races)
    .where(
      and(eq(races.results, "final"), isNotNull(races.lockedAt), gt(races.deadline, new Date(now.getTime() - 4 * 24 * 3600_000))),
    );
  let total = 0;
  for (const race of finals) {
    for (const l of await db.select({ id: leagues.id }).from(leagues)) {
      if ((await getRecapRow(db, l.id, race.id))?.skipAuto) continue;
      const res = await sendRecapToAll(db, l.id, race.id, "", "F1 Underground", "job").catch((e) => {
        // No teams scored yet (e.g. a league with no players): nothing to send.
        if (String(e).includes("No recap")) return { sent: 0 };
        throw e;
      });
      total += res.sent;
    }
  }
  return total;
}
