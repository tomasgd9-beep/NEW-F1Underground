// Who gets which emails. Everyone starts with everything on; each person can turn
// off single kinds or choose "No emails". Every email carries a link that turns
// off its kind without signing in (the per-person token), and the headers Gmail
// and Apple Mail use for their own Unsubscribe button. Sign-in links always send.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { emailPrefs } from "@/db/schema";
import { appUrl, escapeHtml, type MailExtras } from "@/lib/mail";
import { KIND_INFO, type EmailKind, type Prefs } from "@/lib/email-kinds";

export { DEFAULT_PREFS, EMAIL_KINDS, KIND_INFO, type EmailKind, type Prefs } from "@/lib/email-kinds";

export async function getPrefs(db: Db, userId: string): Promise<Prefs> {
  const [row] = await db.select().from(emailPrefs).where(eq(emailPrefs.userId, userId));
  if (!row) return { allOff: false, reminders: true, recaps: true, announcements: true, commissioner: true };
  return {
    allOff: row.allOff,
    reminders: row.reminders,
    recaps: row.recaps,
    announcements: row.announcements,
    commissioner: row.commissioner,
  };
}

export const wants = (p: Prefs, kind: EmailKind) => !p.allOff && p[kind];

/** The person's row (created with everything on if missing), for its token. */
async function ensureRow(db: Db, userId: string) {
  await db.insert(emailPrefs).values({ userId }).onConflictDoNothing();
  const [row] = await db.select().from(emailPrefs).where(eq(emailPrefs.userId, userId));
  return row;
}

export async function setPrefs(db: Db, userId: string, prefs: Prefs) {
  await ensureRow(db, userId);
  await db
    .update(emailPrefs)
    .set({ ...prefs, updatedAt: new Date() })
    .where(eq(emailPrefs.userId, userId));
}

/** Turn off one kind (or everything) from an email link. Returns false for an unknown token. */
export async function unsubscribe(db: Db, token: string, kind: EmailKind | "all") {
  const [row] = await db.select().from(emailPrefs).where(eq(emailPrefs.token, token));
  if (!row) return false;
  await db
    .update(emailPrefs)
    .set(kind === "all" ? { allOff: true, updatedAt: new Date() } : { [kind]: false, updatedAt: new Date() })
    .where(eq(emailPrefs.token, token));
  return true;
}

export async function prefsForToken(db: Db, token: string) {
  const [row] = await db.select().from(emailPrefs).where(eq(emailPrefs.token, token));
  return row ?? null;
}

/** Links, headers and the footer every non-sign-in email carries. */
export async function unsubscribeParts(db: Db, userId: string, kind: EmailKind) {
  const row = await ensureRow(db, userId);
  const q = `t=${row.token}&kind=${kind}`;
  const oneClick = `${appUrl()}/api/unsubscribe?${q}`;
  const page = `${appUrl()}/unsubscribe?${q}`;
  const settings = `${appUrl()}/settings`;
  const label = KIND_INFO[kind].label.toLowerCase();
  const extras: MailExtras = {
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
  return {
    extras,
    text: `\n--\nStop getting the ${label}: ${page}\nChoose which emails you get: ${settings}\n`,
    html:
      `<p style="margin-top:24px;font-size:12px;color:#6b6b76">` +
      `<a href="${page}" style="color:#6b6b76">Stop getting the ${escapeHtml(label)}</a> · ` +
      `<a href="${settings}" style="color:#6b6b76">Choose which emails you get</a></p>`,
  };
}
