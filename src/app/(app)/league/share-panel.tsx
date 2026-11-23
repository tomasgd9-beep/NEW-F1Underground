"use client";

import { useState } from "react";

const KINDS = [
  { kind: "highlights", label: "Highlights", note: "podium and the weekend's stories" },
  { kind: "race", label: "Race results", note: "every team and its points" },
  { kind: "season", label: "Season standings", note: "with places moved" },
  { kind: "graph", label: "Season graph", note: "gap to the leader" },
] as const;

/** "Share" button for a locked race: the four images, each ready to copy or send to WhatsApp. */
export function SharePanel({ raceId, raceLabel }: { raceId: number; raceLabel: string }) {
  const [open, setOpen] = useState(false);
  // A fresh version each time the panel opens, so corrections show up straight away.
  const [stamp, setStamp] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStamp(Date.now());
          setOpen(true);
        }}
        className="ml-auto rounded bg-navy px-3 py-1 text-sm font-semibold text-white"
      >
        Share
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-2 md:p-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-3xl rounded-lg border border-line bg-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
              <b>Share {raceLabel}</b>
              <span className="text-muted">· copy into WhatsApp Web, or share from your phone</span>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto px-2 text-muted" aria-label="Close">
                ✕
              </button>
            </div>
            <ul className="grid gap-3 p-3 sm:grid-cols-2">
              {KINDS.map((k) => (
                <ShareItem key={k.kind} url={`/api/share/${raceId}/${k.kind}.png?v=${stamp}`} {...k} raceLabel={raceLabel} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function ShareItem({
  url,
  kind,
  label,
  note,
  raceLabel,
}: {
  url: string;
  kind: string;
  label: string;
  note: string;
  raceLabel: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const fileName = `f1-underground-${raceLabel.toLowerCase().replace(/\s+/g, "-")}-${kind}.png`;
  const blob = () =>
    fetch(url).then((r) => {
      if (!r.ok) throw new Error("image failed");
      return r.blob();
    });
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };

  const copy = async () => {
    try {
      // Safari needs the promise handed straight to ClipboardItem.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
      flash("Copied: paste it in the chat");
    } catch {
      flash("This browser can't copy images: use Share or Save");
    }
  };
  const share = async () => {
    try {
      const file = new File([await blob()], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      flash("Sharing isn't available here: use Copy or Save");
    } catch (e) {
      if ((e as Error).name !== "AbortError") flash("Couldn't share: try Save");
    }
  };

  return (
    <li className="grid gap-1.5 rounded border border-line p-2">
      <div className="flex items-baseline gap-2 text-sm">
        <b>{label}</b>
        <span className="text-xs text-muted">{note}</span>
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded bg-bg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${label} for ${raceLabel}`} className="max-h-64 w-full object-contain object-top" loading="lazy" />
      </a>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={copy} className="rounded bg-red px-2.5 py-1 text-sm font-semibold text-white">
          Copy
        </button>
        <button type="button" onClick={share} className="rounded border border-line px-2.5 py-1 text-sm font-semibold">
          Share
        </button>
        <a href={url} download={fileName} className="rounded border border-line px-2.5 py-1 text-sm font-semibold">
          Save
        </a>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </li>
  );
}
