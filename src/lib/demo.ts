/** True only in the local demo (npm run dev:local); the real site never is. */
export function demoMode() {
  return process.env.NODE_ENV !== "production" && (process.env.DATABASE_URL ?? "").startsWith("pglite:");
}
