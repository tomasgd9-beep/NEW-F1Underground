import { PlainShell } from "@/components/plain-shell";

export default function CheckEmail() {
  return (
    <PlainShell>
      <h1 className="text-lg font-bold">Check your email</h1>
      <p className="text-sm text-muted">
        We sent you a sign-in link. Open it on this device. It can take a minute; check spam if it doesn&apos;t show
        up.
      </p>
    </PlainShell>
  );
}
