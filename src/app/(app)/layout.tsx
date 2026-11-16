import { TopBar } from "@/components/top-bar";
import { getDb } from "@/db";
import { upcomingRace } from "@/lib/races";
import { requireMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireMember();
  const race = await upcomingRace(getDb());
  return (
    <>
      <TopBar race={race} playerName={viewer.player.displayName} />
      <main className="mx-auto max-w-6xl px-3 pt-3 pb-6">{children}</main>
    </>
  );
}
