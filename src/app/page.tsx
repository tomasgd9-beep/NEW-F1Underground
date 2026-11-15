import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const v = await requireViewer();
  redirect(v.player?.active ? "/team" : "/welcome");
}
