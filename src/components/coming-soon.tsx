/** Placeholder for pages built in later phases. */
export function ComingSoon({ title, phase, what }: { title: string; phase: number; what: string }) {
  return (
    <section className="rounded-lg border border-line bg-card p-4">
      <h1 className="text-base font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted">
        Coming in phase {phase}: {what}
      </p>
    </section>
  );
}
