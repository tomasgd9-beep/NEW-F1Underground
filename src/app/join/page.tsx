import { redirect } from "next/navigation";
import { normaliseCode } from "@/lib/league";

/** The "Join a league" form posts here (?code=...) and lands on /join/CODE. */
export default async function JoinByCode({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const clean = normaliseCode(code ?? "");
  redirect(clean ? `/join/${clean}` : "/welcome");
}
