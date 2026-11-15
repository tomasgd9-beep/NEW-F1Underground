// Outgoing email through a plain SMTP account (e.g. a Gmail app password).
// The free *.vercel.app address can't be verified with Resend, so sending
// from an ordinary mailbox is the free option that reaches everyone.
import nodemailer, { type Transporter } from "nodemailer";

let transport: Transporter | undefined;

function getTransport() {
  if (!transport) {
    const server = process.env.EMAIL_SERVER;
    if (!server) throw new Error("EMAIL_SERVER is not set (see SETUP.md)");
    transport = nodemailer.createTransport(server);
  }
  return transport;
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "F1 Underground <no-reply@example.com>";
}

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!process.env.EMAIL_SERVER && process.env.NODE_ENV !== "production") {
    console.log(`\n[dev] Email to ${to}: ${subject}\n${text}\n`);
    return;
  }
  await getTransport().sendMail({ from: emailFrom(), to, subject, text, html });
}

export function appUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = process.env.AUTH_URL ?? process.env.APP_URL ?? (vercel ? `https://${vercel}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

export async function sendInviteEmail(to: string, inviterName: string, token: string) {
  const url = `${appUrl()}/join/${token}`;
  await sendMail(
    to,
    `${inviterName} invited you to F1 Underground`,
    `${inviterName} invited you to the F1 Underground fantasy league.\n\nJoin here: ${url}\n`,
    `<p>${escapeHtml(inviterName)} invited you to the <b>F1 Underground</b> fantasy league.</p>` +
      `<p><a href="${url}">Join the league</a></p>`,
  );
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
