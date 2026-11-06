import type { ClubQuote } from './quotes.ts'

/** How many recent quotes to keep, and to skip when choosing the next one. */
export const QUOTE_HISTORY_LIMIT = 24

export const QUOTE_MEMORY_KEY = 'cheetahs.daily-quote'
export const FRESH_LOGIN_KEY = 'cheetahs.quote.fresh-login'
export const SEEN_SIGN_IN_KEY = 'cheetahs.quote.seen-sign-in'

/** A sign-in counts as new only when it just happened, not when a tab is restored. */
const FRESH_LOGIN_WINDOW_MS = 3 * 60 * 1000

export type QuoteStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type QuoteMemory = {
  day: string
  quoteId: string
  dismissed: boolean
  history: string[]
}

export type QuoteView = {
  memory: QuoteMemory
  quote: ClubQuote
  visible: boolean
}

export function localDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function greetingFirstName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  const first = fullName?.trim().split(/\s+/)[0]
  if (first && first.length >= 2) return first
  const local = email?.split('@')[0]?.trim() ?? ''
  if (/^[A-Za-z][A-Za-z'-]{1,24}$/.test(local)) {
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
  }
  return 'there'
}

export function rememberQuote(history: readonly string[], id: string): string[] {
  return [id, ...history.filter((item) => item !== id)].slice(0, QUOTE_HISTORY_LIMIT)
}

export function pickQuote(
  quotes: readonly ClubQuote[],
  history: readonly string[],
  random: () => number = Math.random,
): ClubQuote {
  if (quotes.length === 0) throw new Error('No quotes to choose from')
  const avoidCount = Math.min(history.length, Math.max(quotes.length - 1, 0), QUOTE_HISTORY_LIMIT)
  const avoid = new Set(history.slice(0, avoidCount))
  let pool = quotes.filter((quote) => !avoid.has(quote.id))
  if (pool.length === 0) pool = quotes.filter((quote) => quote.id !== history[0])
  if (pool.length === 0) pool = [...quotes]
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index] ?? quotes[0]
}

export function resolveQuoteView(options: {
  quotes: readonly ClubQuote[]
  stored: QuoteMemory | null
  today: string
  freshLogin: boolean
  random?: () => number
}): QuoteView {
  const { quotes, stored, today, freshLogin } = options
  const random = options.random ?? Math.random
  const known = stored ? quotes.some((quote) => quote.id === stored.quoteId) : false
  if (stored && stored.day === today && known && !freshLogin) {
    const quote = quotes.find((item) => item.id === stored.quoteId) ?? quotes[0]
    return { memory: stored, quote, visible: !stored.dismissed }
  }
  const history = stored?.history ?? []
  const quote = pickQuote(quotes, history, random)
  const memory: QuoteMemory = {
    day: today,
    quoteId: quote.id,
    dismissed: false,
    history: rememberQuote(history, quote.id),
  }
  return { memory, quote, visible: true }
}

export function shuffleQuote(
  memory: QuoteMemory,
  quotes: readonly ClubQuote[],
  random: () => number = Math.random,
): QuoteView {
  const history = rememberQuote(memory.history, memory.quoteId)
  const quote = pickQuote(quotes, history, random)
  const next: QuoteMemory = {
    day: memory.day,
    quoteId: quote.id,
    dismissed: false,
    history: rememberQuote(history, quote.id),
  }
  return { memory: next, quote, visible: true }
}

export function dismissQuote(memory: QuoteMemory): QuoteMemory {
  return { ...memory, dismissed: true }
}

function isQuoteMemory(value: unknown): value is QuoteMemory {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.day ?? ''))) return false
  if (typeof row.quoteId !== 'string' || row.quoteId.length === 0) return false
  if (typeof row.dismissed !== 'boolean') return false
  if (!Array.isArray(row.history) || row.history.some((item) => typeof item !== 'string')) return false
  return true
}

export function readQuoteMemory(store: QuoteStore): QuoteMemory | null {
  try {
    const raw = store.getItem(QUOTE_MEMORY_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isQuoteMemory(parsed)) return null
    return { ...parsed, history: parsed.history.slice(0, QUOTE_HISTORY_LIMIT) }
  } catch {
    return null
  }
}

export function writeQuoteMemory(store: QuoteStore, memory: QuoteMemory): void {
  try {
    store.setItem(QUOTE_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // Private browsing can reject storage. The card still works for this view.
  }
}

export function consumeFreshLogin(store: QuoteStore): boolean {
  try {
    const fresh = store.getItem(FRESH_LOGIN_KEY) === '1'
    if (fresh) store.removeItem(FRESH_LOGIN_KEY)
    return fresh
  } catch {
    return false
  }
}

export function noteSignIn(
  store: QuoteStore,
  input: { event: string; accessToken: string | null; lastSignInAt: string | null },
  now = Date.now(),
): void {
  try {
    if (input.event !== 'SIGNED_IN' || !input.accessToken || !input.lastSignInAt) return
    if (store.getItem(SEEN_SIGN_IN_KEY) === input.accessToken) return
    const signedInAt = Date.parse(input.lastSignInAt)
    if (!Number.isFinite(signedInAt)) return
    const age = now - signedInAt
    if (age > FRESH_LOGIN_WINDOW_MS || age < -60_000) return
    store.setItem(SEEN_SIGN_IN_KEY, input.accessToken)
    store.setItem(FRESH_LOGIN_KEY, '1')
  } catch {
    // Ignore storage failures. The daily open still shows a quote.
  }
}
