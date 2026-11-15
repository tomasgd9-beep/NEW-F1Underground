"use client";

import { useEffect, useState } from "react";

/** "2d 07h 18m" until the deadline; ticks every 30 s. */
export function Countdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="opacity-0">00d 00h 00m</span>;
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span>locked</span>;
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return (
    <span>
      {d > 0 && `${d}d `}
      {String(h).padStart(2, "0")}h {String(mm).padStart(2, "0")}m
    </span>
  );
}
