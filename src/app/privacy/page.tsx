import { PlainShell } from "@/components/plain-shell";

export const metadata = { title: "Privacy · F1 Underground" };

/** Public page; Google's sign-in setup needs a privacy policy link. */
export default function Privacy() {
  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Privacy</h1>
      <div className="mt-2 grid gap-2 text-sm">
        <p>
          F1 Underground is a private fantasy league among friends. It is not affiliated with Formula 1, the FIA or
          F1 Fantasy.
        </p>
        <p>
          <b>What we keep:</b> your name and email address from Google or from the sign-in email, the name you play
          under, your team picks and points, and a log of league changes (who did what, when).
        </p>
        <p>
          <b>What it&apos;s for:</b> signing you in, running the league, and sending league emails (sign-in links,
          invites, deadline reminders, race recaps and announcements; choose which you get under Settings, or use the
          link at the bottom of any email). Nothing is sold or shared with anyone outside the league, and there are no ads
          or trackers.
        </p>
        <p>
          <b>Who sees what:</b> other members see your player name, your picks after each deadline, and your points.
          Your email address is visible only to the league&apos;s commissioners.
        </p>
        <p>
          <b>Leaving:</b> ask a commissioner to remove you and your account details are deleted; past results stay in
          the league history under your player name.
        </p>
      </div>
    </PlainShell>
  );
}
