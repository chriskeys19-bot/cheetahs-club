import { actionError } from './errors.ts'
import { missingNewSyncColumns, type SplitwiseSyncSource } from './splitwiseSyncLabel.ts'
import { supabase } from './supabase.ts'

export type { SplitwiseSyncSource } from './splitwiseSyncLabel.ts'

export type SplitwiseMeta = {
  groupId: number | null
  groupName: string | null
  venmoUsername: string
  syncedAt: string | null
  syncSource: SplitwiseSyncSource | null
  lastAttemptAt: string | null
  lastAttemptFailed: boolean
}

export type SplitwiseBalance = {
  splitwiseUserId: number
  profileId: string | null
  email: string | null
  displayName: string
  balanceCents: number
  syncedAt: string
}

export type SplitwiseExpense = {
  id: number
  description: string
  costCents: number
  expenseAt: string
  isPayment: boolean
}

export type SplitwiseShare = {
  expenseId: number
  splitwiseUserId: number
  profileId: string | null
  paidCents: number
  owedCents: number
}

export type SplitwiseDebt = {
  id: number
  fromSplitwiseUserId: number
  toSplitwiseUserId: number
  amountCents: number
}

export type SplitwiseUnmatched = {
  profileId: string
  displayName: string
  email: string | null
}

export type SplitwiseDetail = {
  venmoPlaceholder: boolean
  nonUsd: string[]
  unmatchedProfiles: SplitwiseUnmatched[]
  unmatchedTruncated: boolean
  skippedExpenses: number
}

export type SplitwiseStatus = {
  syncError: string | null
  accountLabel: string | null
  owedByMembersCents: number
  owedToMembersCents: number
  unmappedCount: number
  mappedCount: number
  memberCount: number
  detail: SplitwiseDetail
  updatedAt: string | null
}

export type SplitwiseSnapshot = {
  meta: SplitwiseMeta | null
  balances: SplitwiseBalance[]
  expenses: SplitwiseExpense[]
  shares: SplitwiseShare[]
  debts: SplitwiseDebt[]
  status: SplitwiseStatus | null
}

export type SplitwiseHome = {
  netCents: number | null
  owedByMembersCents: number | null
  owedToMembersCents: number | null
  syncedAt: string
  lastAttemptAt: string | null
  lastAttemptFailed: boolean
  groupName: string | null
  venmoUsername: string
}

const emptyDetail: SplitwiseDetail = {
  venmoPlaceholder: false,
  nonUsd: [],
  unmatchedProfiles: [],
  unmatchedTruncated: false,
  skippedExpenses: 0,
}

export const emptySnapshot: SplitwiseSnapshot = {
  meta: null,
  balances: [],
  expenses: [],
  shares: [],
  debts: [],
  status: null,
}

function splitwiseError(message: string): string {
  const lower = message.toLowerCase()
  const missing =
    lower.includes('schema cache') ||
    lower.includes('could not find the table') ||
    lower.includes('does not exist')
  if (missing && lower.includes('splitwise_')) {
    return 'Splitwise balances are not on the database yet. Apply the splitwise_snapshot migration, then reload.'
  }
  return actionError(message)
}

function parseId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value)) {
    const id = Number(value)
    if (Number.isSafeInteger(id)) return id
  }
  return null
}

function parseCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(amount)) return null
  return amount
}

function parseSyncSource(value: unknown): SplitwiseSyncSource | null {
  if (value === 'scheduled' || value === 'manual' || value === 'service') return value
  return null
}

function parseMeta(value: unknown): SplitwiseMeta | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.venmo_username !== 'string') return null
  const groupId = row.group_id == null ? null : parseId(row.group_id)
  return {
    groupId,
    groupName: typeof row.group_name === 'string' ? row.group_name : null,
    venmoUsername: row.venmo_username,
    syncedAt: typeof row.synced_at === 'string' ? row.synced_at : null,
    syncSource: parseSyncSource(row.sync_source),
    lastAttemptAt: typeof row.last_attempt_at === 'string' ? row.last_attempt_at : null,
    lastAttemptFailed: row.last_attempt_failed === true,
  }
}

const META_COLUMNS = 'group_id, group_name, venmo_username, synced_at, sync_source, last_attempt_at, last_attempt_failed'
const META_COLUMNS_LEGACY = 'group_id, group_name, venmo_username, synced_at'
const HOME_META_COLUMNS = 'group_name, venmo_username, synced_at, sync_source, last_attempt_at, last_attempt_failed'
const HOME_META_COLUMNS_LEGACY = 'group_name, venmo_username, synced_at'

async function loadMeta(columns: string, legacyColumns: string) {
  const client = supabase
  if (!client) return { data: null, error: { message: 'Supabase is not configured.' } }
  const first = await client.from('splitwise_meta').select(columns).eq('id', 1).maybeSingle()
  if (first.error && missingNewSyncColumns(first.error.message)) {
    return client.from('splitwise_meta').select(legacyColumns).eq('id', 1).maybeSingle()
  }
  return first
}

function parseBalances(value: unknown): SplitwiseBalance[] {
  if (!Array.isArray(value)) return []
  const rows: SplitwiseBalance[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = parseId(row.splitwise_user_id)
    const amount = parseCents(row.balance_cents)
    if (id === null || amount === null || typeof row.display_name !== 'string' || typeof row.synced_at !== 'string') continue
    rows.push({
      splitwiseUserId: id,
      profileId: typeof row.profile_id === 'string' ? row.profile_id : null,
      email: typeof row.email === 'string' ? row.email : null,
      displayName: row.display_name,
      balanceCents: amount,
      syncedAt: row.synced_at,
    })
  }
  return rows
}

function parseExpenses(value: unknown): SplitwiseExpense[] {
  if (!Array.isArray(value)) return []
  const rows: SplitwiseExpense[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = parseId(row.splitwise_expense_id)
    const cost = parseCents(row.cost_cents)
    if (id === null || cost === null || typeof row.description !== 'string' || typeof row.expense_at !== 'string') continue
    rows.push({
      id,
      description: row.description,
      costCents: cost,
      expenseAt: row.expense_at,
      isPayment: row.is_payment === true,
    })
  }
  return rows
}

function parseShares(value: unknown): SplitwiseShare[] {
  if (!Array.isArray(value)) return []
  const rows: SplitwiseShare[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const expenseId = parseId(row.splitwise_expense_id)
    const userId = parseId(row.splitwise_user_id)
    const paid = parseCents(row.paid_cents)
    const owed = parseCents(row.owed_cents)
    if (expenseId === null || userId === null || paid === null || owed === null) continue
    rows.push({
      expenseId,
      splitwiseUserId: userId,
      profileId: typeof row.profile_id === 'string' ? row.profile_id : null,
      paidCents: paid,
      owedCents: owed,
    })
  }
  return rows
}

function parseDebts(value: unknown): SplitwiseDebt[] {
  if (!Array.isArray(value)) return []
  const rows: SplitwiseDebt[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = parseId(row.id)
    const fromId = parseId(row.from_splitwise_user_id)
    const toId = parseId(row.to_splitwise_user_id)
    const amount = parseCents(row.amount_cents)
    if (id === null || fromId === null || toId === null || amount === null) continue
    rows.push({ id, fromSplitwiseUserId: fromId, toSplitwiseUserId: toId, amountCents: amount })
  }
  return rows
}

function parseDetail(value: unknown): SplitwiseDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyDetail
  const row = value as Record<string, unknown>
  const nonUsd = Array.isArray(row.non_usd)
    ? row.non_usd.filter((item): item is string => typeof item === 'string').slice(0, 12)
    : []
  const unmatchedProfiles: SplitwiseUnmatched[] = []
  if (Array.isArray(row.unmatched_profiles)) {
    for (const item of row.unmatched_profiles) {
      if (!item || typeof item !== 'object') continue
      const profile = item as Record<string, unknown>
      if (typeof profile.profile_id !== 'string' || typeof profile.display_name !== 'string') continue
      unmatchedProfiles.push({
        profileId: profile.profile_id,
        displayName: profile.display_name,
        email: typeof profile.email === 'string' ? profile.email : null,
      })
    }
  }
  return {
    venmoPlaceholder: row.venmo_placeholder === true,
    nonUsd,
    unmatchedProfiles,
    unmatchedTruncated: row.unmatched_truncated === true,
    skippedExpenses: typeof row.skipped_expenses === 'number' ? row.skipped_expenses : 0,
  }
}

function parseStatus(value: unknown): SplitwiseStatus | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const owedBy = parseCents(row.owed_by_members_cents)
  const owedTo = parseCents(row.owed_to_members_cents)
  const unmapped = parseCents(row.unmapped_count)
  const mapped = parseCents(row.mapped_count)
  const members = parseCents(row.member_count)
  if (owedBy === null || owedTo === null || unmapped === null || mapped === null || members === null) return null
  return {
    syncError: typeof row.sync_error === 'string' ? row.sync_error : null,
    accountLabel: typeof row.account_label === 'string' ? row.account_label : null,
    owedByMembersCents: owedBy,
    owedToMembersCents: owedTo,
    unmappedCount: unmapped,
    mappedCount: mapped,
    memberCount: members,
    detail: parseDetail(row.detail),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

function firstError(messages: (string | null | undefined)[]): string | null {
  for (const message of messages) {
    if (message) return splitwiseError(message)
  }
  return null
}

export async function loadSplitwiseSnapshot(staff: boolean): Promise<{ snapshot: SplitwiseSnapshot; error: string | null }> {
  if (!supabase) return { snapshot: emptySnapshot, error: 'Supabase is not configured.' }
  const client = supabase
  const [metaResult, balanceResult, expenseResult, shareResult, debtResult, statusResult] = await Promise.all([
    loadMeta(META_COLUMNS, META_COLUMNS_LEGACY),
    client.from('splitwise_balances').select('splitwise_user_id, profile_id, email, display_name, balance_cents, synced_at').limit(300),
    client.from('splitwise_expenses').select('splitwise_expense_id, description, cost_cents, expense_at, is_payment').limit(40),
    client.from('splitwise_shares').select('splitwise_expense_id, splitwise_user_id, profile_id, paid_cents, owed_cents').limit(2000),
    staff
      ? client.from('splitwise_debts').select('id, from_splitwise_user_id, to_splitwise_user_id, amount_cents').limit(1000)
      : Promise.resolve({ data: [], error: null }),
    staff
      ? client.from('splitwise_status').select('sync_error, account_label, owed_by_members_cents, owed_to_members_cents, unmapped_count, mapped_count, member_count, detail, updated_at').eq('id', 1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const snapshot: SplitwiseSnapshot = {
    meta: parseMeta(metaResult.data),
    balances: parseBalances(balanceResult.data),
    expenses: parseExpenses(expenseResult.data),
    shares: parseShares(shareResult.data),
    debts: parseDebts(debtResult.data),
    status: parseStatus(statusResult.data),
  }
  return {
    snapshot,
    error: firstError([
      metaResult.error?.message,
      balanceResult.error?.message,
      expenseResult.error?.message,
      shareResult.error?.message,
      debtResult.error?.message,
      statusResult.error?.message,
    ]),
  }
}

export async function loadSplitwiseHome(userId: string, staff: boolean): Promise<SplitwiseHome | null> {
  if (!supabase) return null
  const client = supabase
  const [metaResult, mineResult, statusResult] = await Promise.all([
    loadMeta(HOME_META_COLUMNS, HOME_META_COLUMNS_LEGACY),
    client.from('splitwise_balances').select('balance_cents').eq('profile_id', userId).limit(20),
    staff
      ? client.from('splitwise_status').select('owed_by_members_cents, owed_to_members_cents').eq('id', 1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (metaResult.error || mineResult.error || statusResult.error) return null
  const meta = parseMeta(metaResult.data)
  if (!meta?.syncedAt) return null
  const amounts = Array.isArray(mineResult.data) ? mineResult.data : []
  let netCents: number | null = amounts.length > 0 ? 0 : null
  for (const row of amounts) {
    const cents = parseCents((row as { balance_cents?: unknown }).balance_cents)
    if (cents === null) return null
    netCents = (netCents ?? 0) + cents
  }
  const status = statusResult.data as { owed_by_members_cents?: unknown; owed_to_members_cents?: unknown } | null
  return {
    netCents,
    owedByMembersCents: staff ? parseCents(status?.owed_by_members_cents) : null,
    owedToMembersCents: staff ? parseCents(status?.owed_to_members_cents) : null,
    syncedAt: meta.syncedAt,
    lastAttemptAt: meta.lastAttemptAt,
    lastAttemptFailed: meta.lastAttemptFailed,
    groupName: meta.groupName,
    venmoUsername: meta.venmoUsername,
  }
}

async function readInvokeError(error: unknown): Promise<string> {
  const context = error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
  if (context instanceof Response) {
    const text = await context.clone().text()
    try {
      const body = JSON.parse(text) as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    } catch {
      return 'Could not refresh Splitwise.'
    }
  }
  return 'Could not refresh Splitwise.'
}

export async function syncSplitwise(force: boolean): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase.functions.invoke('sync-splitwise', { body: { force } })
  if (error) return readInvokeError(error)
  if (!data || typeof data !== 'object') return 'Could not refresh Splitwise.'
  const body = data as { ok?: unknown; error?: unknown }
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
  if (body.ok !== true) return 'Could not refresh Splitwise.'
  return null
}

export function netBalance(rows: SplitwiseBalance[]): number {
  return rows.reduce((sum, row) => sum + row.balanceCents, 0)
}
