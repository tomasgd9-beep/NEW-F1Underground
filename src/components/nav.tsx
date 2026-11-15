"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const TABS = [
  { href: "/team", label: "My team" },
  { href: "/points", label: "Points" },
  { href: "/league", label: "League" },
  { href: "/admin", label: "Admin" },
] as const;

/** Tabs in the top bar on desktop. */
export function TopTabs() {
  const path = usePathname();
  return (
    <nav className="hidden md:flex items-stretch h-full">
      {TABS.map((t) => {
        const on = path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center px-3 text-sm font-semibold border-b-2 ${
              on ? "border-red text-white" : "border-transparent text-white/70 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tabs pinned to the bottom on phones. */
export function BottomTabs() {
  const path = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-navy grid grid-cols-4 border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => {
        const on = path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`py-2.5 text-center text-xs font-semibold ${on ? "text-white" : "text-white/60"}`}
          >
            <span className={`inline-block pb-0.5 border-b-2 ${on ? "border-red" : "border-transparent"}`}>
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
