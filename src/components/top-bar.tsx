import Link from "next/link";
import { signOut } from "@/auth";
import { Countdown } from "./countdown";
import { PhoneTabs, TopTabs } from "./nav";

type Race = { label: string; name: string; deadline: Date | null } | undefined;

/** The one slim bar: league name, tabs, next race + countdown, sign out. */
export function TopBar({ race, playerName }: { race: Race; playerName?: string }) {
  return (
    <header id="top-bar" className="sticky top-0 z-20 bg-navy text-white">
      <div className="mx-auto max-w-6xl h-12 px-3 flex items-center gap-4">
        <Link href="/team" className="font-bold tracking-tight whitespace-nowrap">
          <span className="text-red">F1</span> Underground
        </Link>
        <TopTabs />
        <div className="ml-auto flex items-center gap-3 text-sm">
          {race?.deadline && (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-white/70">{race.label}</span>
              <span className="rounded bg-red px-1.5 py-0.5 font-semibold">
                <Countdown deadline={race.deadline.toISOString()} />
              </span>
            </span>
          )}
          {playerName && (
            <>
              <Link href="/settings" className="text-white/60 hover:text-white" title="Settings: which emails you get">
                <span className="hidden sm:inline">{playerName}</span>
                <span className="sm:hidden" aria-label="Settings">
                  ⚙
                </span>
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/signin" });
                }}
              >
                <button className="text-white/60 hover:text-white" title="Sign out">
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      <PhoneTabs />
    </header>
  );
}
