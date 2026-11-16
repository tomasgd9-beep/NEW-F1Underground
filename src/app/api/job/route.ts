// The same run as the 15-minute GitHub job, for an outside timer (cron-job.org) to call.
// GitHub's schedule is unreliable (runs can be hours apart), so this keeps locks, scores
// and emails on time. Protected by JOB_SECRET: send it as "Authorization: Bearer <secret>".
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { runScheduledJob } from "@/lib/job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.JOB_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not allowed" }, { status: 401 });
  }
  try {
    const res = await runScheduledJob(getDb(), "job");
    return NextResponse.json({ ok: true, locked: res.lock?.race ?? null, priced: res.prices?.race ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
