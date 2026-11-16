import { after } from "next/server";
import { TopBar } from "@/components/top-bar";
import { getDb } from "@/db";
import { runScheduledJob } from "@/lib/job";
import { upcomingRace } from "@/lib/races";
import { requireMember } from "@/lib/session";
import { currentRace } from "@/lib/team";

// Backup for a late schedule: the first visit after a deadline locks the race
// (in the background, after the page is sent). At most one try per minute per server.
let lastKick = 0;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireMember();
  const db = getDb();
  const race = await upcomingRace(db);
  const cur = await currentRace(db);
  if (cur && !cur.lockedAt && cur.deadline && cur.deadline <= new Date() && Date.now() - lastKick > 60_000) {
    lastKick = Date.now();
    after(() => runScheduledJob(db, "page").catch(() => {}));
  }
  return (
    <>
      <TopBar race={race} playerName={viewer.player.displayName} />
      <main className="mx-auto max-w-6xl px-3 pt-3 pb-6">{children}</main>
    </>
  );
}
