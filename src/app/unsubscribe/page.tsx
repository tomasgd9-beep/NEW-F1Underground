import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PlainShell } from "@/components/plain-shell";
import { unsubscribeAction } from "@/app/actions";
import { KIND_INFO, type EmailKind } from "@/lib/email-kinds";

export const metadata = { title: "Unsubscribe · F1 Underground" };

/**
 * The page an email's "Stop getting…" link opens. It asks before changing anything,
 * because some mail apps open links on their own to check them.
 */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ t?: string; kind?: string }> }) {
  const { t = "", kind = "" } = await searchParams;
  const info = KIND_INFO[kind as EmailKind];
  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Emails from F1 Underground</h1>
      {!t ? (
        <p className="mt-2 text-sm text-muted">This link is incomplete. Sign in and open Settings to choose your emails.</p>
      ) : (
        <div className="mt-2 grid gap-3 text-sm">
          {info && (
            <ActionForm action={unsubscribeAction} className="grid gap-1">
              <input type="hidden" name="t" value={t} />
              <input type="hidden" name="kind" value={kind} />
              <p>
                Stop getting the <b>{info.label.toLowerCase()}</b> ({info.note})?
              </p>
              <div>
                <SubmitButton>Stop these emails</SubmitButton>
              </div>
            </ActionForm>
          )}
          <ActionForm action={unsubscribeAction} className="grid gap-1">
            <input type="hidden" name="t" value={t} />
            <input type="hidden" name="kind" value="all" />
            <p className="text-muted">Or stop every league email (sign-in links still arrive when you ask for one).</p>
            <div>
              <SubmitButton variant="quiet">No emails at all</SubmitButton>
            </div>
          </ActionForm>
          <p className="text-xs text-muted">
            Changed your mind? Sign in and open <Link href="/settings" className="underline">Settings</Link> to turn
            emails back on.
          </p>
        </div>
      )}
    </PlainShell>
  );
}
