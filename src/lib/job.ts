// One job run against f1fantasytools, shared by the 5-minute timer, GitHub's backup schedule and
// the Admin "Sync now" button.
import type { Db } from "@/db";
import { fetchExpectedPoints, fetchLive } from "@/lib/fft";
import { logActivity } from "@/lib/league";
import { alertCommissioners, sendDeadlineReminders, sendLockNotices } from "@/lib/notify";
import { runJob, type RunResult } from "@/lib/sync";

export async function runScheduledJob(db: Db, actor = "job"): Promise<RunResult> {
  try {
    const live = await fetchLive();
    const res = await runJob(db, live, (round) => fetchExpectedPoints(round));
    await logActivity(db, actor, "sync", {
      current: res.sync?.current,
      next: res.sync?.next,
      results: res.sync?.state,
      points: res.sync?.points,
      ...(res.lock ? { locked: res.lock.race } : {}),
      ...(res.prices ? { priced: res.prices.race } : {}),
    });
    // Emails never break the score update: a failure is logged and retried next run.
    for (const [what, send] of [
      ["reminders", sendDeadlineReminders],
      ["lock notices", sendLockNotices],
    ] as const) {
      try {
        await send(db);
      } catch (e) {
        await logActivity(db, actor, what, undefined, { result: `error: ${e instanceof Error ? e.message : e}` });
      }
    }
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity(db, actor, "sync", undefined, { result: `error: ${msg}` });
    if (actor === "job") await alertCommissioners(db, msg).catch(() => {});
    throw e;
  }
}
