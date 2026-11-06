import { supabase } from './supabase.ts'
import { shouldAttemptSplitwiseEnsure, type SplitwiseEnsureRow } from './splitwiseEnsurePlan.ts'

export type SplitwiseEnsureNotice = {
  synced: boolean
}

export type SplitwiseAddFailure = {
  profileId: string
  displayName: string
  email: string | null
  error: string
}

export type SplitwiseAddSummary = {
  added: number
  alreadyMember: number
  alreadyRecorded: number
  failed: number
  skipped: number
  remaining: number
  rateLimited: boolean
  synced: boolean
  failures: SplitwiseAddFailure[]
}

const listeners = new Set<(notice: SplitwiseEnsureNotice) => void>()
let lastNotice: SplitwiseEnsureNotice | null = null
let ticket = 0
let scheduled = false
const attempted = new Set<string>()

export function onSplitwiseEnsureSettled(listener: (notice: SplitwiseEnsureNotice) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function takeSplitwiseEnsureNotice(): SplitwiseEnsureNotice | null {
  const notice = lastNotice
  lastNotice = null
  return notice
}

export function resetSplitwiseEnsureOnSignOut(): void {
  attempted.clear()
  lastNotice = null
  ticket += 1
  scheduled = false
}

function publish(notice: SplitwiseEnsureNotice): void {
  lastNotice = notice
  for (const listener of listeners) listener(notice)
}

function parseRow(value: unknown): SplitwiseEnsureRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    splitwiseAddedAt: typeof row.splitwise_added_at === 'string' ? row.splitwise_added_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    lastAttemptAt: typeof row.last_attempt_at === 'string' ? row.last_attempt_at : null,
  }
}

function parseCount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN
  if (!Number.isInteger(amount) || amount < 0) return null
  return amount
}

function parseSummary(value: unknown): SplitwiseAddSummary | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const added = parseCount(row.added)
  const alreadyMember = parseCount(row.already_member)
  const alreadyRecorded = parseCount(row.already_recorded)
  const failed = parseCount(row.failed)
  const skipped = parseCount(row.skipped)
  const remaining = parseCount(row.remaining)
  if (
    added === null ||
    alreadyMember === null ||
    alreadyRecorded === null ||
    failed === null ||
    skipped === null ||
    remaining === null
  ) {
    return null
  }
  const failures: SplitwiseAddFailure[] = []
  if (Array.isArray(row.failures)) {
    for (const item of row.failures) {
      if (!item || typeof item !== 'object') continue
      const failure = item as Record<string, unknown>
      if (typeof failure.profile_id !== 'string' || typeof failure.display_name !== 'string') continue
      if (typeof failure.error !== 'string' || !failure.error.trim()) continue
      failures.push({
        profileId: failure.profile_id,
        displayName: failure.display_name,
        email: typeof failure.email === 'string' ? failure.email : null,
        error: failure.error.trim(),
      })
    }
  }
  return {
    added,
    alreadyMember,
    alreadyRecorded,
    failed,
    skipped,
    remaining,
    rateLimited: row.rate_limited === true,
    synced: row.synced === true,
    failures,
  }
}

async function readInvokeError(error: unknown, fallback: string): Promise<string> {
  const context = error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
  if (context instanceof Response) {
    const text = await context.clone().text()
    try {
      const body = JSON.parse(text) as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    } catch {
      return fallback
    }
  }
  return fallback
}

function publishIfLinked(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const body = data as { ok?: unknown; status?: unknown; synced?: unknown }
  if (body.ok !== true) return
  if (body.status !== 'added' && body.status !== 'already_member') return
  publish({ synced: body.synced === true })
}

async function runEnsure(explicitSignIn: boolean, mine: number): Promise<void> {
  if (mine !== ticket) return
  const client = supabase
  if (!client) return
  const { data: sessionData } = await client.auth.getSession()
  if (mine !== ticket) return
  const userId = sessionData.session?.user.id
  if (!userId || attempted.has(userId)) return
  attempted.add(userId)

  const existing = await client
    .from('splitwise_membership')
    .select('splitwise_added_at, last_error, last_attempt_at')
    .eq('profile_id', userId)
    .maybeSingle()
  if (existing.error) {
    console.error('Splitwise membership lookup failed')
    return
  }
  if (!shouldAttemptSplitwiseEnsure(parseRow(existing.data), Date.now(), explicitSignIn)) return

  const { data, error } = await client.functions.invoke('splitwise-ensure-member', { body: {} })
  if (error) {
    console.error('Splitwise membership was not recorded')
    return
  }
  publishIfLinked(data)
}

// Fire-and-forget. Sign-in does not wait on this, and a thrown error stays here.
export function ensureSplitwiseMembership(explicitSignIn: boolean): void {
  if (scheduled) return
  scheduled = true
  const mine = ticket
  setTimeout(() => {
    scheduled = false
    void runEnsure(explicitSignIn, mine).catch(() => {
      console.error('Splitwise membership was not recorded')
    })
  }, 0)
}

export async function addAllSplitwiseMembers(): Promise<{ summary: SplitwiseAddSummary | null; error: string | null }> {
  if (!supabase) return { summary: null, error: 'Supabase is not configured.' }
  const { data, error } = await supabase.functions.invoke('splitwise-ensure-member', { body: { all: true } })
  if (error) return { summary: null, error: await readInvokeError(error, 'Could not add members to Splitwise.') }
  const summary = parseSummary(data)
  if (!summary) return { summary: null, error: 'Could not add members to Splitwise.' }
  return { summary, error: null }
}
