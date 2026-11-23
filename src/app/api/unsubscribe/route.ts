// One-click unsubscribe (RFC 8058): Gmail's and Apple Mail's own "Unsubscribe" button POSTs here.
import { getDb } from "@/db";
import { EMAIL_KINDS, unsubscribe, type EmailKind } from "@/lib/email-prefs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  if (!(EMAIL_KINDS as readonly string[]).includes(kind)) return new Response("Unknown email kind", { status: 400 });
  const ok = await unsubscribe(getDb(), t, kind as EmailKind);
  return new Response(ok ? "Unsubscribed" : "Unknown link", { status: ok ? 200 : 404 });
}

/** Opening the link in a browser goes to the page that asks first. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.redirect(new URL(`/unsubscribe${url.search}`, url), 303);
}
