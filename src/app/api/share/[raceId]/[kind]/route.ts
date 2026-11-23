// A share image (Highlights, Race, Season or Graph) for one race, for any league member.
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { races } from "@/db/schema";
import { getPlayerForUser } from "@/lib/league";
import { loadLeague } from "@/lib/league-data";
import { buildRecap } from "@/lib/recap";
import { SHARE_KINDS, shareFileName, shareImage, type ShareKind } from "@/lib/share-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ raceId: string; kind: string }> }) {
  const { raceId, kind } = await params;
  const session = await auth();
  if (!session?.user?.id) return new Response("Sign in first", { status: 401 });
  const db = getDb();
  const player = await getPlayerForUser(db, session.user.id);
  if (!player?.active) return new Response("Not in the league", { status: 403 });
  const k = kind.replace(/\.png$/, "") as ShareKind;
  if (!SHARE_KINDS.includes(k)) return new Response("Unknown image", { status: 404 });

  const [race] = await db.select({ seasonId: races.seasonId }).from(races).where(eq(races.id, Number(raceId)));
  if (!race) return new Response("No such race", { status: 404 });
  const data = await loadLeague(db, player.leagueId, player.id, race.seasonId);
  const recap = data && buildRecap(data, Number(raceId));
  if (!recap) return new Response("Teams for this race aren't locked yet", { status: 404 });

  const png = await shareImage(k, recap);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${shareFileName(k, recap)}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
