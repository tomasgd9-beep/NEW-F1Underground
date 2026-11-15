import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { getPlayerForUser, pendingClaimForUser, type Player } from "@/lib/league";

export type Viewer = {
  userId: string;
  email: string | null;
  name: string | null;
  player: Player | undefined;
  isCommissioner: boolean;
};

/** The signed-in viewer, or a redirect to sign-in. */
export async function requireViewer(): Promise<Viewer> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const player = await getPlayerForUser(getDb(), session.user.id);
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    player,
    isCommissioner: !!player?.active && player.role === "commissioner",
  };
}

/** A signed-in league member, or the "not in the league yet" page. */
export async function requireMember(): Promise<Viewer & { player: Player }> {
  const v = await requireViewer();
  if (!v.player || !v.player.active) redirect("/welcome");
  return v as Viewer & { player: Player };
}

export async function viewerPendingClaim(userId: string) {
  return pendingClaimForUser(getDb(), userId);
}
