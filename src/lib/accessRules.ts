export const SIGNUP_PATH = '/signup'

export function signupUrl(origin: string): string {
  const base = origin.trim().replace(/\/+$/, '')
  return `${base}${SIGNUP_PATH}`
}

/** Prefer a side they asked for and this person can assign. */
export function defaultTeamId(requestedIds: readonly string[], assignableIds: readonly string[]): string {
  for (const id of requestedIds) {
    if (assignableIds.includes(id)) return id
  }
  return assignableIds[0] ?? ''
}
