"use client";
// The first line of the League and Points pages: league name, season chip,
// join code with a copy button, and an optional control on the right.
import Link from "next/link";
import { useState, type ReactNode } from "react";

export function LeagueHeader({
  leagueName,
  seasons,
  seasonId,
  basePath,
  code,
  joinUrl,
  right,
}: {
  leagueName: string;
  seasons: { id: number; year: number }[];
  seasonId: number | null;
  basePath: string;
  code: string | null;
  joinUrl: string;
  right?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const current = seasons.find((s) => s.id === seasonId);
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {/* The league's name is already in the top bar (only one league for now); keep it for screen readers. */}
      <h1 className="sr-only">{leagueName}</h1>
      {current && (
        <details className="relative shrink-0">
          <summary className="cursor-pointer list-none rounded-full border border-line bg-card px-2 py-0.5 text-xs font-semibold whitespace-nowrap sm:px-2.5 sm:text-sm">
            {current.year} ▾
          </summary>
          <div className="absolute left-0 z-20 mt-1 min-w-24 rounded border border-line bg-card py-1 shadow">
            {[...seasons].reverse().map((s) => (
              <Link
                key={s.id}
                href={`${basePath}?season=${s.id}`}
                className={`block px-3 py-1 text-sm ${s.id === seasonId ? "font-bold" : "text-muted"}`}
              >
                {s.year}
              </Link>
            ))}
          </div>
        </details>
      )}
      {code && (
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(joinUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex shrink-0 items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 text-xs sm:gap-1.5 sm:px-2 sm:text-sm"
          title="Copy the join link"
        >
          <span className="hidden text-muted sm:inline">Code</span>
          <b className="sm:tracking-widest">{code}</b>
          <span className="font-semibold text-red">{copied ? "Copied" : <><span className="sm:hidden">Copy</span><span className="hidden sm:inline">Copy link</span></>}</span>
        </button>
      )}
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}
