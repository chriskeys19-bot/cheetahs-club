// Keep the ten-minute window in step with ENSURE_COOLDOWN_MS in
// supabase/functions/_shared/splitwise.ts. Session restore uses it so a failed
// add is not retried on every page load. A fresh sign-in still calls the
// function. The server applies the same window before it talks to Splitwise.

export const SPLITWISE_ENSURE_COOLDOWN_MS = 10 * 60 * 1000

export type SplitwiseEnsureRow = {
  splitwiseAddedAt: string | null
  lastError: string | null
  lastAttemptAt: string | null
}

export function shouldAttemptSplitwiseEnsure(
  row: SplitwiseEnsureRow | null,
  now: number,
  explicitSignIn: boolean,
): boolean {
  if (row?.splitwiseAddedAt) return false
  if (explicitSignIn) return true
  if (!row?.lastError || !row.lastAttemptAt) return true
  const at = new Date(row.lastAttemptAt).getTime()
  if (Number.isNaN(at)) return true
  const age = now - at
  if (age < 0) return false
  return age >= SPLITWISE_ENSURE_COOLDOWN_MS
}
