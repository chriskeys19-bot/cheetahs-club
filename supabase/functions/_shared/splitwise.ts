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

// Ten minutes. Keep this in step with SPLITWISE_ENSURE_COOLDOWN_MS in
// src/lib/splitwiseEnsurePlan.ts. A failed add waits this long before the
// next Splitwise call so a page reload does not hammer the API.
export const ENSURE_COOLDOWN_MS = 10 * 60 * 1000

export const SPLITWISE_RATE_LIMIT_MESSAGE = 'Splitwise rate limit. Wait a few minutes, then try again.'
export const SPLITWISE_ADD_FAILED_MESSAGE = 'Splitwise did not add this member.'
export const SPLITWISE_UNAVAILABLE_MESSAGE = 'Splitwise did not respond. Try again.'
export const SPLITWISE_UNAUTHORIZED_MESSAGE = 'Splitwise rejected the API key.'
export const SPLITWISE_FORBIDDEN_MESSAGE = 'Splitwise refused this account.'
export const SPLITWISE_GROUP_MISSING_MESSAGE = 'Splitwise did not find that group.'
export const SPLITWISE_MEMBER_CAP = 300

export type GroupMemberRef = {
  id: number
  email: string | null
}

export type AddUserResult =
  | { kind: 'added'; userId: number }
  | { kind: 'already' }
  | { kind: 'rate_limit' }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'failed'; message: string }

export function scrubSecret(message: string, secrets: readonly string[]): string {
  let text = message.replace(/[\r\n]+/g, ' ')
  text = text.replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, 'bearer [redacted]')
  for (const secret of secrets) {
    if (secret.length >= 8) text = text.split(secret).join('[redacted]')
  }
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  return text.trim().slice(0, 300)
}

export function ensureOnCooldown(lastError: unknown, lastAttemptAt: unknown, now: number): boolean {
  if (typeof lastError !== 'string' || !lastError.trim()) return false
  if (typeof lastAttemptAt !== 'string') return false
  const at = new Date(lastAttemptAt).getTime()
  if (Number.isNaN(at)) return false
  const age = now - at
  if (age < 0) return true
  return age < ENSURE_COOLDOWN_MS
}

// Splitwise requires both names when it invites an address that has no account.
// A one-word club name keeps the given name and uses Member for the family name.
export function splitPersonName(fullName: unknown, email: string | null): { firstName: string; lastName: string } {
  const named = cleanLabel(fullName, 80, '')
  const local = email ? (email.split('@')[0] ?? '') : ''
  const fromEmail = cleanLabel(local.replace(/[._-]+/g, ' '), 80, '')
  const source = named || fromEmail || 'Member'
  const parts = source.split(' ').filter((part) => part.length > 0)
  const firstName = cleanLabel(parts[0], 50, 'Member')
  const lastName = cleanLabel(parts.slice(1).join(' '), 50, 'Member')
  return { firstName, lastName }
}

function positiveUserId(value: unknown): number | null {
  const id =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return id
}

export function groupMemberRefs(value: unknown): { members: GroupMemberRef[]; truncated: boolean } | null {
  if (!Array.isArray(value)) return null
  if (value.length > SPLITWISE_MEMBER_CAP) return { members: [], truncated: true }
  const members: GroupMemberRef[] = []
  const seen = new Set<number>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = positiveUserId(row.id)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    members.push({ id, email: normalizeEmail(row.email) })
  }
  return { members, truncated: false }
}

export function memberIdForEmail(members: readonly GroupMemberRef[], email: string | null): number | null {
  const wanted = normalizeEmail(email)
  if (!wanted) return null
  for (const member of members) {
    if (member.email === wanted) return member.id
  }
  return null
}

function splitwiseErrorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join(' ')
  }
  if (!value || typeof value !== 'object') return ''
  const parts: string[] = []
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (typeof entry === 'string') parts.push(entry)
    else if (Array.isArray(entry)) {
      for (const item of entry) {
        if (typeof item === 'string') parts.push(item)
      }
    }
  }
  return parts.join(' ')
}

function alreadyMemberMessage(detail: string): boolean {
  const lower = detail.toLowerCase()
  return lower.includes('already') && (lower.includes('member') || lower.includes('group') || lower.includes('exist'))
}

// 200 OK is not success. Splitwise sets success false and an errors object when the add is refused.
export function interpretAddUser(status: number, body: unknown, secrets: readonly string[] = []): AddUserResult {
  if (status === 429) return { kind: 'rate_limit' }
  if (status === 401) return { kind: 'unauthorized', message: SPLITWISE_UNAUTHORIZED_MESSAGE }
  if (status === 403) return { kind: 'unauthorized', message: SPLITWISE_FORBIDDEN_MESSAGE }
  if (status === 404) return { kind: 'failed', message: SPLITWISE_GROUP_MISSING_MESSAGE }
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const detail = scrubSecret(splitwiseErrorText(record?.errors), secrets)
  if (record?.success === true) {
    const user = record.user && typeof record.user === 'object' && !Array.isArray(record.user)
      ? (record.user as Record<string, unknown>)
      : null
    const id = positiveUserId(user?.id)
    if (id === null) return { kind: 'failed', message: 'Splitwise did not return a member id.' }
    return { kind: 'added', userId: id }
  }
  if (detail.toLowerCase().includes('rate limit')) return { kind: 'rate_limit' }
  if (alreadyMemberMessage(detail)) return { kind: 'already' }
  if (status >= 500 || status === 0) return { kind: 'failed', message: SPLITWISE_UNAVAILABLE_MESSAGE }
  if (!detail || /bearer|api[_ -]?key|\btoken\b|\bsecret\b/i.test(detail)) {
    return { kind: 'failed', message: SPLITWISE_ADD_FAILED_MESSAGE }
  }
  return { kind: 'failed', message: detail.slice(0, 180) }
}
