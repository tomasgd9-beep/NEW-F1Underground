import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PlainShell } from "@/components/plain-shell";
import { demoMode } from "@/lib/demo";

export const dynamic = "force-dynamic";


const DEMO = [
  { who: "tomas", label: "Tomás", note: "commissioner" },
  { who: "ana", label: "Ana", note: "player" },
  { who: "new", label: "New Person", note: "waiting for a commissioner to confirm them as IV" },
  { who: "guest", label: "Guest", note: "signed in, not in the league yet" },
];

export default function DevLogin() {
  if (!demoMode()) notFound();
  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Demo sign-in</h1>
      <p className="text-sm text-muted">Local demo only. Pick who to be:</p>
      <div className="mt-3 grid gap-2">
        {DEMO.map((d) => (
          <form
            key={d.who}
            action={async () => {
              "use server";
              if (!demoMode()) notFound();
              (await cookies()).set("authjs.session-token", `demo-session-${d.who}`, { path: "/", httpOnly: true });
              redirect("/");
            }}
          >
            <button className="w-full rounded border border-line px-3 py-2 text-left hover:bg-black/5">
              <b>{d.label}</b> <span className="text-sm text-muted">· {d.note}</span>
            </button>
          </form>
        ))}
      </div>
    </PlainShell>
  );
}
