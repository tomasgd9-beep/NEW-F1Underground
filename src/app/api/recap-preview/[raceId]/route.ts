// The recap email as you'd get it, in the browser (commissioners, before sending).
import { auth } from "@/auth";
import { getDb } from "@/db";
import { getPlayerForUser } from "@/lib/league";
import { getRecapRow, loadRecap, recapEmail } from "@/lib/recap-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const raceId = Number((await params).raceId);
  const session = await auth();
  if (!session?.user?.id) return new Response("Sign in first", { status: 401 });
  const db = getDb();
  const me = await getPlayerForUser(db, session.user.id);
  if (!me?.active || me.role !== "commissioner") return new Response("Commissioners only", { status: 403 });
  const loaded = await loadRecap(db, me.leagueId, raceId);
  if (!loaded) return new Response("No recap for that race yet: teams have to be locked and scored.", { status: 404 });
  const row = await getRecapRow(db, me.leagueId, raceId);
  const mail = recapEmail(loaded.recap, { ...loaded, note: row?.note ?? "", author: me.displayName }, { name: me.displayName, playerId: me.id });
  const html = mail.html.replace(/cid:season-graph@f1underground/g, `/api/share/${raceId}/graph.png`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${mail.subject}</title>` +
      `<body style="margin:0;padding:16px;background:#fff"><p style="font:13px sans-serif;color:#6b6b76;max-width:640px;margin:0 auto 12px">Subject: <b style="color:#15151e">${mail.subject.replace(/</g, "&lt;")}</b></p>${html}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
