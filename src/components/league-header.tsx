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
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-lg font-bold">{leagueName}</h1>
      {current && (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full border border-line bg-card px-2.5 py-0.5 text-sm font-semibold">
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
          className="flex items-center gap-1.5 rounded border border-line bg-card px-2 py-0.5 text-sm"
          title="Copy the join link"
        >
          <span className="text-muted">Code</span>
          <b className="tracking-widest">{code}</b>
          <span className="font-semibold text-red">{copied ? "Copied" : "Copy link"}</span>
        </button>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
