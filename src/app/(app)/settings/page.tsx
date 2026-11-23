import { getDb } from "@/db";
import { getPrefs } from "@/lib/email-prefs";
import { requireMember } from "@/lib/session";
import { EmailSettings } from "./email-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · F1 Underground" };

export default async function Settings() {
  const v = await requireMember();
  const prefs = await getPrefs(getDb(), v.userId);
  return (
    <div className="mx-auto grid max-w-xl gap-3">
      <section className="rounded-lg border border-line bg-card">
        <div className="border-b border-line px-3 py-2">
          <h1 className="text-sm font-bold">Emails</h1>
          <p className="text-xs text-muted">
            Sent to {v.email ?? "your account's address"}. Sign-in links always arrive, whatever you choose here.
          </p>
        </div>
        <div className="p-3">
          <EmailSettings prefs={prefs} isCommissioner={v.isCommissioner} />
        </div>
      </section>
    </div>
  );
}
