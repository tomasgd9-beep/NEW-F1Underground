"use client";
// A race chip that drops down the season's races, most recent first (same feel
// as the season chip). Items either navigate (href) or call onSelect.
import Link from "next/link";
import { useRef } from "react";

/** `note` marks a race that can't be opened yet or ever ("upcoming", "cancelled"). */
export type PickerRace = { id: number; label: string; name: string; href?: string; note?: string };

export function RacePicker({
  races,
  currentId,
  onSelect,
}: {
  races: PickerRace[];
  currentId: number;
  onSelect?: (id: number) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const current = races.find((r) => r.id === currentId);
  const close = () => ref.current?.removeAttribute("open");
  const ordered = [...races].reverse(); // most recent first
  return (
    <details ref={ref} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-navy bg-navy px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap text-white">
        {current?.label ?? "Race"} ▾
      </summary>
      <div className="absolute left-0 z-30 mt-1 max-h-80 w-60 overflow-y-auto rounded border border-line bg-card py-1 shadow-lg">
        {ordered.map((r) => {
          const cls = `flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 ${
            r.id === currentId ? "font-bold" : ""
          }`;
          const body = (
            <>
              <span className="w-16 shrink-0 font-semibold">{r.label}</span>
              <span className="truncate text-muted">{r.name}</span>
              {r.note && <span className="ml-auto shrink-0 text-[10px] uppercase text-muted">{r.note}</span>}
            </>
          );
          if (r.note)
            return (
              <div key={r.id} className={`${cls} cursor-default opacity-50 hover:bg-transparent dark:hover:bg-transparent`}>
                {body}
              </div>
            );
          return r.href ? (
            <Link key={r.id} href={r.href} className={cls} onClick={close}>
              {body}
            </Link>
          ) : (
            <button
              key={r.id}
              type="button"
              className={cls}
              onClick={() => {
                onSelect?.(r.id);
                close();
              }}
            >
              {body}
            </button>
          );
        })}
      </div>
    </details>
  );
}
