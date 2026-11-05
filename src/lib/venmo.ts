// Venmo has no consumer API we can call. These are payment links.
// https://venmo.com/<username>?txn=pay&amount=12.50&note=...&audience=private
// Keep the username pattern in step with sanitizeVenmoUsername in
// supabase/functions/_shared/splitwise.ts.

export const VENMO_PLACEHOLDER = 'cheetahs'

function readViteVenmo(): string {
  const value = import.meta.env?.VITE_VENMO_USERNAME
  return typeof value === 'string' ? value : ''
}

export function sanitizeVenmoUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const handle = value.trim().replace(/^@+/, '')
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(handle)) return null
  return handle
}

export function resolveVenmoUsername(meta: { venmoUsername: string; syncedAt: string | null } | null): string {
  if (meta?.syncedAt) {
    const fromSync = sanitizeVenmoUsername(meta.venmoUsername)
    if (fromSync) return fromSync
  }
  const fromEnv = sanitizeVenmoUsername(readViteVenmo())
  if (fromEnv) return fromEnv
  return VENMO_PLACEHOLDER
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
  const handle = sanitizeVenmoUsername(username)
  if (!handle) return null
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
