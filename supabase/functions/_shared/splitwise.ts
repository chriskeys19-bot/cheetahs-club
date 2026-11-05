// Pure helpers for the Splitwise sync. No secrets and no network.
// Balance sign, from Splitwise group member balances: negative means that
// member owes the group; positive means the group owes that member.

export const MAX_CENTS = 100_000_000

export function moneyToCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const scaled = value * 100
    const rounded = Math.round(scaled)
    if (Math.abs(scaled - rounded) > 1e-6) return null
    return signedCents(Math.abs(rounded), value < 0)
  }
  if (typeof value !== 'string') return null
  const match = /^(-?)(\d{1,9})(?:\.(\d+))?$/.exec(value.trim())
  if (!match) return null
  const negative = match[1] === '-'
  const whole = Number(match[2])
  const frac = match[3] ?? ''
  const frac2 = Number((frac + '00').slice(0, 2))
  const extra = frac[2] ?? '0'
  let cents = whole * 100 + frac2
  if (extra >= '5') cents += 1
  return signedCents(cents, negative)
}

function signedCents(cents: number, negative: boolean): number | null {
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null
  if (cents === 0) return 0
  return negative ? -cents : cents
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 320) return null
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null
  return email
}

// Keep the pattern in step with sanitizeVenmoUsername in src/lib/venmo.ts.
export function sanitizeVenmoUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const handle = value.trim().replace(/^@+/, '')
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(handle)) return null
  return handle
}

export function cleanLabel(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback
  let cleaned = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    cleaned += code < 32 || code === 127 ? ' ' : char
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  if (!cleaned) return fallback
  return cleaned.slice(0, max)
}

export function personName(first: unknown, last: unknown, fallback: string): string {
  const given = typeof first === 'string' ? first : ''
  const family = typeof last === 'string' ? last : ''
  return cleanLabel(`${given} ${family}`, 120, fallback)
}

export type UsdBalance = {
  cents: number
  nonUsd: string[]
}

// Returns null when a present amount cannot be read. Missing USD means 0.
export function usdBalanceCents(entries: unknown): UsdBalance | null {
  if (entries == null) return { cents: 0, nonUsd: [] }
  if (!Array.isArray(entries)) return null
  let usd = 0
  let sawUsd = false
  const nonUsd: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as { currency_code?: unknown; amount?: unknown }
    const code = typeof row.currency_code === 'string' ? row.currency_code.trim().toUpperCase() : ''
    if (!/^[A-Z]{3}$/.test(code)) continue
    const cents = moneyToCents(row.amount)
    if (cents === null) return null
    if (code === 'USD') {
      sawUsd = true
      usd += cents
    } else if (cents !== 0 && !nonUsd.includes(code)) {
      nonUsd.push(code)
    }
  }
  if (sawUsd && (usd > MAX_CENTS || usd < -MAX_CENTS)) return null
  return { cents: sawUsd ? usd : 0, nonUsd }
}
