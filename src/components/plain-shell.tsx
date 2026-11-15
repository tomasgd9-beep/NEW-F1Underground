/** Minimal page shell for sign-in and joining (no tabs). */
export function PlainShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-md h-12 px-4 flex items-center font-bold tracking-tight">
          <span className="text-red">F1</span>&nbsp;Underground
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-4">
        <section className="rounded-lg border border-line bg-card p-4">{children}</section>
      </main>
    </>
  );
}
