import { and, asc, gt, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { races } from "@/db/schema";

/** The next race whose deadline is still ahead, for the top bar countdown. */
export async function upcomingRace(db: Db, now = new Date()) {
  const [r] = await db
    .select({ id: races.id, label: races.label, name: races.name, deadline: races.deadline })
    .from(races)
    .where(and(gt(races.deadline, now), ne(races.status, "cancelled")))
    .orderBy(asc(races.deadline))
    .limit(1);
  return r;
}
