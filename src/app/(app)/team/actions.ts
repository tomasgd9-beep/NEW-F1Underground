"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { LeagueError } from "@/lib/league";
import type { Picks } from "@/lib/lineup";
import { requireMember } from "@/lib/session";
import { savePicks } from "@/lib/team";

export type SaveResult =
  | { ok: true; savedAt: string; price: number; penalty: number }
  | { ok: false; error: string };

export async function saveTeam(raceId: number, picks: Picks): Promise<SaveResult> {
  const v = await requireMember();
  try {
    const r = await savePicks(getDb(), v.userId, raceId, picks);
    revalidatePath("/team");
    return { ok: true, savedAt: r.savedAt.toISOString(), price: r.price, penalty: r.penalty };
  } catch (e) {
    if (e instanceof LeagueError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
}
