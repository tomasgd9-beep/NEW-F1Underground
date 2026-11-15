// One job run against f1fantasytools, shared by the 15-minute schedule and
// the Admin "Sync now" button.
import type { Db } from "@/db";
import { fetchExpectedPoints, fetchLive } from "@/lib/fft";
import { logActivity } from "@/lib/league";
import { runJob, type RunResult } from "@/lib/sync";

export async function runScheduledJob(db: Db, actor = "job"): Promise<RunResult> {
  try {
    const live = await fetchLive();
    const res = await runJob(db, live, async (round) => (await fetchExpectedPoints(round))?.xp ?? null);
    await logActivity(db, actor, "sync", {
      current: res.sync?.current,
      next: res.sync?.next,
      results: res.sync?.state,
      points: res.sync?.points,
      ...(res.lock ? { locked: res.lock.race } : {}),
      ...(res.prices ? { priced: res.prices.race } : {}),
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity(db, actor, "sync", undefined, { result: `error: ${msg}` });
    throw e;
  }
}
