/** Type a league code; submits to /join?code=... */
export function CodeForm({ autoFocus = false }: { autoFocus?: boolean }) {
  return (
    <form action="/join" method="get" className="flex gap-2">
      <input
        name="code"
        required
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="League code, e.g. 7K3P9X"
        className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1.5 font-semibold uppercase tracking-widest placeholder:font-normal placeholder:normal-case placeholder:tracking-normal"
      />
      <button className="rounded bg-red px-4 font-semibold text-white">Join</button>
    </form>
  );
}
