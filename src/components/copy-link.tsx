"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1 flex gap-2">
      <input readOnly value={url} className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-xs" />
      <button
        type="button"
        className="rounded bg-navy px-2.5 py-1 text-sm font-semibold text-white"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
