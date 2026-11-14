import { actionError } from './errors.ts'
import { splitwiseSyncLabel } from './splitwiseSyncLabel.ts'
import {
  explicitMemoToken,
  normalizeName,
  reminderMmdd,
  zelleEmailOrDefault,
  type SheetAccount,
  type SheetCharge,
} from './sheetLedger.ts'
import { supabase } from './supabase.ts'
import { isClubRole, type ClubRole } from './types.ts'

const PACIFIC = 'America/Los_Angeles'

export type SheetSyncSource = 'scheduled' | 'manual'

export function sheetSyncedLabel(input: {
  syncedAt: string | null
  lastAttemptFailed: boolean
  lastAttemptAt: string | null
}): string {
  return splitwiseSyncLabel({
    syncedAt: input.syncedAt,
    lastAttemptFailed: input.lastAttemptFailed,
    lastAttemptAt: input.lastAttemptAt,
    timeZone: PACIFIC,
  })
}

export type SheetSettings = {
  zelleEmail: string
  reminderMmdd: string
}

export type SheetMeta = {
  syncedAt: string | null
  syncSource: SheetSyncSource | null
  lastAttemptAt: string | null
  lastAttemptFailed: boolean
}

export type SheetStatus = {
  syncError: string | null
  unmatchedNames: string[]
  accountCount: number
  chargeCount: number
}

export type SheetNameMap = {
  id: string
  sheetKey: string
  sheetName: string
  profileId: string
}

export type SheetMemo = {
  profileId: string
  memoToken: string
}

export type SheetRosterRow = {
  id: string
  fullName: string | null
  role: ClubRole
}

export type SheetMemberDesk = {
  settings: SheetSettings
  meta: SheetMeta | null
  status: SheetStatus | null
  accounts: SheetAccount[]
  charges: SheetCharge[]
  memo: SheetMemo | null
  roster: SheetRosterRow[]
}

export type SheetClubDesk = {
  settings: SheetSettings
  meta: SheetMeta | null
  status: SheetStatus | null
  accounts: SheetAccount[]
  maps: SheetNameMap[]
  memos: SheetMemo[]
  roster: SheetRosterRow[]
}

const ACCOUNT_COLUMNS =
  'id, sheet_key, sheet_name, profile_id, club_status, club_fee_cents, club_fee_status, umpiring_fee_cents, umpiring_status, received_saro_cents, received_ben_cents, received_total_cents, game_charges_total_cents, balance_due_cents, payment_notes'

const CHARGE_COLUMNS =
  'id, sheet_key, sheet_name, profile_id, sheet_row, charge_date, charge_type, game_label, charge_kind, team, ground, amount_cents, recon_status'

const defaultSettings: SheetSettings = {
  zelleEmail: 'treasurercheetahscricket@gmail.com',
  reminderMmdd: '1114',
}

function sheetError(message: string): string {
  const lower = message.toLowerCase()
  const missing =
    lower.includes('schema cache') ||
    lower.includes('could not find') ||
    lower.includes('does not exist')
  const names =
    lower.includes('sheet_dues') ||
    lower.includes('finance_dues') ||
    lower.includes('finance_sheet') ||
    lower.includes('sheet_name_map') ||
    lower.includes('member_dues_memo')
  if (missing && names) {
    return 'Club sheet dues are not on the database yet. Apply supabase/migrations/20261114211000_sheet_dues.sql, then reload.'
  }
  if (lower.includes('admin role required')) return 'Only an admin can change the club sheet.'
  if (lower.includes('sign in required')) return 'Sign in, then try again.'
  return actionError(message)
}

function firstError(messages: (string | null | undefined)[]): string | null {
  for (const message of messages) {
    if (message) return sheetError(message)
  }
  return null
}

function parseCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(amount)) return null
  return amount
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseSettings(value: unknown): SheetSettings {
  if (!value || typeof value !== 'object') return defaultSettings
  const row = value as Record<string, unknown>
  return {
    zelleEmail: zelleEmailOrDefault(typeof row.zelle_email === 'string' ? row.zelle_email : null),
    reminderMmdd: reminderMmdd(typeof row.reminder_mmdd === 'string' ? row.reminder_mmdd : null),
  }
}

function parseMeta(value: unknown): SheetMeta | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const source = row.sync_source === 'scheduled' || row.sync_source === 'manual' ? row.sync_source : null
  return {
    syncedAt: typeof row.synced_at === 'string' ? row.synced_at : null,
    syncSource: source,
    lastAttemptAt: typeof row.last_attempt_at === 'string' ? row.last_attempt_at : null,
    lastAttemptFailed: row.last_attempt_failed === true,
  }
}

function parseStatus(value: unknown): SheetStatus | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const unmatched: string[] = []
  if (Array.isArray(row.unmatched_names)) {
    for (const name of row.unmatched_names) {
      if (typeof name === 'string' && name.trim()) unmatched.push(name.trim())
    }
  }
  return {
    syncError: textOrNull(row.sync_error),
    unmatchedNames: unmatched,
    accountCount: parseCents(row.account_count) ?? 0,
    chargeCount: parseCents(row.charge_count) ?? 0,
  }
}

function parseAccount(value: unknown): SheetAccount | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const clubFee = parseCents(row.club_fee_cents)
  const umpiring = parseCents(row.umpiring_fee_cents)
  const saro = parseCents(row.received_saro_cents)
  const ben = parseCents(row.received_ben_cents)
  const received = parseCents(row.received_total_cents)
  const balance = parseCents(row.balance_due_cents)
  if (
    typeof row.id !== 'string' ||
    typeof row.sheet_key !== 'string' ||
    typeof row.sheet_name !== 'string' ||
    clubFee == null ||
    umpiring == null ||
    saro == null ||
    ben == null ||
    received == null ||
    balance == null
  ) {
    return null
  }
  const games = row.game_charges_total_cents == null ? null : parseCents(row.game_charges_total_cents)
  return {
    id: row.id,
    sheetKey: row.sheet_key,
    sheetName: row.sheet_name,
    profileId: typeof row.profile_id === 'string' ? row.profile_id : null,
    clubStatus: textOrNull(row.club_status),
    clubFeeCents: clubFee,
    clubFeeStatus: textOrNull(row.club_fee_status),
    umpiringFeeCents: umpiring,
    umpiringStatus: textOrNull(row.umpiring_status),
    receivedSaroCents: saro,
    receivedBenCents: ben,
    receivedTotalCents: received,
    gameChargesTotalCents: games,
    balanceDueCents: balance,
    paymentNotes: textOrNull(row.payment_notes),
  }
}

function parseAccounts(value: unknown): SheetAccount[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = parseAccount(item)
    return row ? [row] : []
  })
}

const CHARGE_KINDS = new Set(['dues', 'water', 'umpire', 'other'])

function parseCharge(value: unknown): SheetCharge | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const amount = parseCents(row.amount_cents)
  const sheetRow = parseCents(row.sheet_row)
  if (
    typeof row.id !== 'string' ||
    typeof row.sheet_key !== 'string' ||
    typeof row.sheet_name !== 'string' ||
    typeof row.charge_type !== 'string' ||
    typeof row.charge_kind !== 'string' ||
    !CHARGE_KINDS.has(row.charge_kind) ||
    amount == null ||
    sheetRow == null
  ) {
    return null
  }
  return {
    id: row.id,
    sheetKey: row.sheet_key,
    sheetName: row.sheet_name,
    profileId: typeof row.profile_id === 'string' ? row.profile_id : null,
    sheetRow,
    chargeDate: typeof row.charge_date === 'string' ? row.charge_date : null,
    chargeType: row.charge_type,
    gameLabel: textOrNull(row.game_label),
    chargeKind: row.charge_kind as SheetCharge['chargeKind'],
    team: textOrNull(row.team),
    ground: textOrNull(row.ground),
    amountCents: amount,
    reconStatus: textOrNull(row.recon_status),
  }
}

function parseCharges(value: unknown): SheetCharge[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = parseCharge(item)
    return row ? [row] : []
  })
}

function parseMaps(value: unknown): SheetNameMap[] {
  if (!Array.isArray(value)) return []
  const rows: SheetNameMap[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.sheet_key !== 'string' ||
      typeof row.sheet_name !== 'string' ||
      typeof row.profile_id !== 'string'
    ) {
      continue
    }
    rows.push({ id: row.id, sheetKey: row.sheet_key, sheetName: row.sheet_name, profileId: row.profile_id })
  }
  return rows
}

function parseMemos(value: unknown): SheetMemo[] {
  if (!Array.isArray(value)) return []
  const rows: SheetMemo[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.profile_id !== 'string' || typeof row.memo_token !== 'string') continue
    rows.push({ profileId: row.profile_id, memoToken: row.memo_token })
  }
  return rows
}

function parseRoster(value: unknown): SheetRosterRow[] {
  if (!Array.isArray(value)) return []
  const rows: SheetRosterRow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !isClubRole(row.role)) continue
    rows.push({
      id: row.id,
      fullName: typeof row.full_name === 'string' ? row.full_name : null,
      role: row.role,
    })
  }
  return rows
}

async function readInvokeError(error: unknown): Promise<string> {
  const context = error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
  if (context instanceof Response) {
    const text = await context.clone().text()
    try {
      const body = JSON.parse(text) as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    } catch {
      return 'Could not sync the club sheet.'
    }
  }
  return 'Could not sync the club sheet.'
}

export async function loadSheetMember(input: {
  memberId: string
  staff: boolean
}): Promise<{ desk: SheetMemberDesk; error: string | null }> {
  const empty: SheetMemberDesk = {
    settings: defaultSettings,
    meta: null,
    status: null,
    accounts: [],
    charges: [],
    memo: null,
    roster: [],
  }
  if (!supabase) return { desk: empty, error: 'Supabase is not configured.' }
  const client = supabase
  const [settingsResult, metaResult, statusResult, accountResult, chargeResult, memoResult, rosterResult] =
    await Promise.all([
      client.from('finance_dues_settings').select('zelle_email, reminder_mmdd').eq('id', 1).maybeSingle(),
      client.from('finance_sheet_meta').select('synced_at, sync_source, last_attempt_at, last_attempt_failed').eq('id', 1).maybeSingle(),
      input.staff
        ? client.from('finance_sheet_status').select('sync_error, unmatched_names, account_count, charge_count').eq('id', 1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client.from('sheet_dues_accounts').select(ACCOUNT_COLUMNS).eq('profile_id', input.memberId).limit(20),
      client
        .from('sheet_dues_charges')
        .select(CHARGE_COLUMNS)
        .eq('profile_id', input.memberId)
        .order('sheet_row', { ascending: true })
        .limit(500),
      client.from('member_dues_memo').select('profile_id, memo_token').eq('profile_id', input.memberId).maybeSingle(),
      input.staff ? client.rpc('dues_roster') : Promise.resolve({ data: [], error: null }),
    ])
  const memos = memoResult.data ? parseMemos([memoResult.data]) : []
  return {
    desk: {
      settings: parseSettings(settingsResult.data),
      meta: parseMeta(metaResult.data),
      status: parseStatus(statusResult.data),
      accounts: parseAccounts(accountResult.data),
      charges: parseCharges(chargeResult.data),
      memo: memos[0] ?? null,
      roster: parseRoster(rosterResult.data),
    },
    error: firstError([
      settingsResult.error?.message,
      metaResult.error?.message,
      statusResult.error?.message,
      accountResult.error?.message,
      chargeResult.error?.message,
      memoResult.error?.message,
      rosterResult.error?.message,
    ]),
  }
}

export async function loadSheetClub(): Promise<{ desk: SheetClubDesk; error: string | null }> {
  const empty: SheetClubDesk = {
    settings: defaultSettings,
    meta: null,
    status: null,
    accounts: [],
    maps: [],
    memos: [],
    roster: [],
  }
  if (!supabase) return { desk: empty, error: 'Supabase is not configured.' }
  const client = supabase
  const [settingsResult, metaResult, statusResult, accountResult, mapResult, memoResult, rosterResult] =
    await Promise.all([
      client.from('finance_dues_settings').select('zelle_email, reminder_mmdd').eq('id', 1).maybeSingle(),
      client.from('finance_sheet_meta').select('synced_at, sync_source, last_attempt_at, last_attempt_failed').eq('id', 1).maybeSingle(),
      client.from('finance_sheet_status').select('sync_error, unmatched_names, account_count, charge_count').eq('id', 1).maybeSingle(),
      client.from('sheet_dues_accounts').select(ACCOUNT_COLUMNS).order('sheet_name', { ascending: true }).limit(300),
      client.from('sheet_name_map').select('id, sheet_key, sheet_name, profile_id').order('sheet_name', { ascending: true }).limit(300),
      client.from('member_dues_memo').select('profile_id, memo_token').limit(300),
      client.rpc('dues_roster'),
    ])
  return {
    desk: {
      settings: parseSettings(settingsResult.data),
      meta: parseMeta(metaResult.data),
      status: parseStatus(statusResult.data),
      accounts: parseAccounts(accountResult.data),
      maps: parseMaps(mapResult.data),
      memos: parseMemos(memoResult.data),
      roster: parseRoster(rosterResult.data),
    },
    error: firstError([
      settingsResult.error?.message,
      metaResult.error?.message,
      statusResult.error?.message,
      accountResult.error?.message,
      mapResult.error?.message,
      memoResult.error?.message,
      rosterResult.error?.message,
    ]),
  }
}

export async function syncFinanceSheet(rematch = false): Promise<{ error: string | null; notice: string | null }> {
  if (!supabase) return { error: 'Supabase is not configured.', notice: null }
  const { data, error } = await supabase.functions.invoke('sync-finance-sheet', {
    body: rematch ? { rematch: true } : {},
  })
  if (error) return { error: await readInvokeError(error), notice: null }
  if (!data || typeof data !== 'object') return { error: 'Could not sync the club sheet.', notice: null }
  const body = data as { ok?: unknown; error?: unknown; configured?: unknown }
  if (typeof body.error === 'string' && body.error.trim()) return { error: body.error.trim(), notice: null }
  if (body.configured === false) {
    return {
      error: null,
      notice: 'The club sheet is not connected yet. Add the Apps Script URL in Vault, then sync again.',
    }
  }
  if (body.ok !== true) return { error: 'Could not sync the club sheet.', notice: null }
  return { error: null, notice: null }
}

async function changed(
  result: { data: unknown; error: { message: string } | null },
  emptyMessage: string,
): Promise<string | null> {
  if (result.error) return sheetError(result.error.message)
  if (!Array.isArray(result.data) || result.data.length === 0) return emptyMessage
  return null
}

export async function saveSheetNameMap(sheetName: string, profileId: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const display = sheetName.trim().replace(/\s+/g, ' ')
  const sheetKey = normalizeName(display)
  if (!sheetKey || !profileId) return 'Choose the sheet name and the member.'
  const saved = await supabase
    .from('sheet_name_map')
    .upsert({ sheet_key: sheetKey, sheet_name: display, profile_id: profileId }, { onConflict: 'sheet_key' })
    .select('id')
  const message = await changed(saved, 'That name link could not be saved.')
  if (message) return message
  const relink = await syncFinanceSheet(true)
  return relink.error
}

export async function removeSheetNameMap(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const removed = await supabase.from('sheet_name_map').delete().eq('id', id).select('id')
  const message = await changed(removed, 'That name link could not be removed.')
  if (message) return message
  const relink = await syncFinanceSheet(true)
  return relink.error
}

export async function saveDuesSettings(email: string, mmdd: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const zelleEmail = email.trim()
  const reminder = mmdd.trim()
  if (zelleEmailOrDefault(zelleEmail) !== zelleEmail) return 'Enter the Zelle email address.'
  if (reminderMmdd(reminder) !== reminder) return 'Use a month and day, like 1114.'
  const saved = await supabase
    .from('finance_dues_settings')
    .update({ zelle_email: zelleEmail, reminder_mmdd: reminder })
    .eq('id', 1)
    .select('id')
  return changed(saved, 'Those payment details could not be saved.')
}

export async function saveMemoOverride(profileId: string, rawToken: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const memoToken = explicitMemoToken(rawToken)
  if (!profileId || !memoToken) return 'Choose a member and a memo name, like SRIVATSANSR.'
  const saved = await supabase
    .from('member_dues_memo')
    .upsert({ profile_id: profileId, memo_token: memoToken }, { onConflict: 'profile_id' })
    .select('profile_id')
  return changed(saved, 'That memo could not be saved.')
}

export async function removeMemoOverride(profileId: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const removed = await supabase.from('member_dues_memo').delete().eq('profile_id', profileId).select('profile_id')
  return changed(removed, 'That memo could not be removed.')
}
