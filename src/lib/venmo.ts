// Venmo has no consumer API we can call. These are payment links.
// https://venmo.com/<username>?txn=pay&amount=12.50&note=...&audience=private
// Keep the username pattern in step with sanitizeVenmoUsername in
// supabase/functions/_shared/splitwise.ts.

export const VENMO_PLACEHOLDER = 'cheetahs'

function readEnv(name: 'VITE_VENMO_USERNAME' | 'VITE_VENMO_ENABLED'): string {
  const value = import.meta.env?.[name]
  return typeof value === 'string' ? value : ''
}

// Pay buttons stay off until a build sets this to true. Unset means false.
export function venmoFeatureEnabled(): boolean {
  return readEnv('VITE_VENMO_ENABLED').trim().toLowerCase() === 'true'
}

export function sanitizeVenmoUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const handle = value.trim().replace(/^@+/, '')
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(handle)) return null
  return handle
}

// `cheetahs` is the old unset sentinel stored when VENMO_USERNAME is missing.
// It is not a club handle, including when a build still sets VITE_VENMO_USERNAME=cheetahs.
function configuredVenmoUsername(value: unknown): string | null {
  const handle = sanitizeVenmoUsername(value)
  if (!handle || handle === VENMO_PLACEHOLDER) return null
  return handle
}

export function resolveVenmoUsername(meta: { venmoUsername: string; syncedAt: string | null } | null): string | null {
  if (meta?.syncedAt) {
    const fromSync = configuredVenmoUsername(meta.venmoUsername)
    if (fromSync) return fromSync
  }
  return configuredVenmoUsername(readEnv('VITE_VENMO_USERNAME'))
}

// Null hides every Venmo button, pay link, and setup note that depends on a handle.
export function venmoPayHandle(meta: { venmoUsername: string; syncedAt: string | null } | null): string | null {
  if (!venmoFeatureEnabled()) return null
  return resolveVenmoUsername(meta)
}

function withoutControls(value: string): string {
  let cleaned = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    cleaned += code < 32 || code === 127 ? ' ' : char
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

export function duesVenmoNote(period: string): string {
  const clean = withoutControls(period)
  const suffix = clean.length > 0 ? clean : 'this period'
  return `Cheetahs dues · ${suffix}`.slice(0, 200)
}

export function venmoPayUrl(username: string, amountCents: number, note: string): string | null {
  if (!venmoFeatureEnabled()) return null
  const handle = sanitizeVenmoUsername(username)
  if (!handle || handle === VENMO_PLACEHOLDER) return null
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) return null
  const cleanNote = withoutControls(note).slice(0, 200)
  if (!cleanNote) return null
  const amount = (amountCents / 100).toFixed(2)
  const params = new URLSearchParams({
    txn: 'pay',
    amount,
    note: cleanNote,
    audience: 'private',
  })
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`
}
