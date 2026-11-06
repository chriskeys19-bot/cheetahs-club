import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import {
  cleanLabel,
  moneyToCents,
  normalizeEmail,
  personName,
  sanitizeVenmoUsername,
  usdBalanceCents,
} from '../_shared/splitwise.ts'

// Copies one Splitwise group into RLS-safe tables.
// Secrets stay here. The browser sends a captain JWT, or cron sends
// x-splitwise-cron. This function only GETs Splitwise. It does not create
// expenses or record payments there.
//
// The Self-Serve API is not for commercial products. Club/hobby use.
// See docs/splitwise-venmo.md.

const SPLITWISE_API = 'https://secure.splitwise.com/api/v3.0'
const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'
// Stored when VENMO_USERNAME is unset. The column cannot be blank.
// The SPA treats this sentinel as "no handle" and does not render pay links for it.
const VENMO_PLACEHOLDER = 'cheetahs'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

type AdminClient = SupabaseClient

type ClubProfile = {
  id: string
  email: string | null
  displayName: string
}

type GroupMember = {
  id: number
  email: string | null
  displayName: string
  balanceCents: number
  profileId: string | null
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-splitwise-cron',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function logSafe(message: string): string {
  return message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').slice(0, 300)
}

function secretsMatch(given: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(given)
  const right = encoder.encode(expected)
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!
  return diff === 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function positiveId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return id
}

async function readForce(req: Request): Promise<{ force: boolean; bypass: boolean } | Response> {
  const text = await req.text()
  if (text.length > 400) return json(req, 413, { error: 'Request is too large.' })
  if (!text.trim()) return { force: false, bypass: false }
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }
  const record = asRecord(body)
  if (!record) return json(req, 400, { error: 'Send JSON.' })
  if (record.force !== undefined && typeof record.force !== 'boolean') {
    return json(req, 400, { error: 'force must be true or false.' })
  }
  if (record.bypass !== undefined && typeof record.bypass !== 'boolean') {
    return json(req, 400, { error: 'bypass must be true or false.' })
  }
  return { force: record.force === true, bypass: record.bypass === true }
}

async function authorize(req: Request): Promise<{ ok: true; service: boolean } | Response> {
  const cronGiven = req.headers.get('x-splitwise-cron') ?? ''
  const cronExpected = (Deno.env.get('SPLITWISE_CRON_SECRET') ?? '').trim()
  if (cronGiven && secretsMatch(cronGiven, cronExpected)) return { ok: true, service: false }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  // splitwise-ensure-member calls this after a successful add so the dues
  // copy includes the new member. The browser never has this key. bypass in
  // the body is ignored unless this match succeeds. Do not log the header.
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
  if (jwt && serviceKey && secretsMatch(jwt, serviceKey)) return { ok: true, service: true }
  if (!jwt || jwt.split('.').length !== 3) return json(req, 401, { error: 'Sign in as a captain or admin, then refresh.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return json(req, 500, { error: 'Could not refresh Splitwise.' })

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user) return json(req, 401, { error: 'Sign in as a captain or admin, then refresh.' })

  const profileResult = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = profileResult.data?.role
  if (profileResult.error || (role !== 'admin' && role !== 'captain')) {
    return json(req, 403, { error: 'Captains and admins can refresh Splitwise.' })
  }
  return { ok: true, service: false }
}

function adminClient(): AdminClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function freshSyncedAt(admin: AdminClient, force: boolean): Promise<string | null> {
  const result = await admin.from('splitwise_meta').select('synced_at').eq('id', 1).maybeSingle()
  const syncedAt = result.data?.synced_at
  if (result.error || typeof syncedAt !== 'string') return null
  const synced = new Date(syncedAt).getTime()
  if (Number.isNaN(synced)) return null
  const age = Date.now() - synced
  const windowMs = force ? 15_000 : 60_000
  if (age >= 0 && age < windowMs) return syncedAt
  return null
}

async function noteSyncError(admin: AdminClient, message: string): Promise<void> {
  const syncError = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)
  if (!syncError) return
  const result = await admin.rpc('replace_splitwise_snapshot', {
    payload: { mode: 'error', sync_error: syncError },
  })
  if (result.error) console.error('sync-splitwise note failed', logSafe(result.error.message))
}

async function splitwiseToken(): Promise<{ token: string } | { error: string }> {
  const apiKey = (Deno.env.get('SPLITWISE_API_KEY') ?? '').trim()
  if (apiKey) return { token: apiKey }

  const clientId = (Deno.env.get('SPLITWISE_CLIENT_ID') ?? '').trim()
  const clientSecret = (Deno.env.get('SPLITWISE_CLIENT_SECRET') ?? '').trim()
  const refresh = (Deno.env.get('SPLITWISE_REFRESH_TOKEN') ?? '').trim()
  if (!clientId || !clientSecret || !refresh) {
    return {
      error:
        'Splitwise is not set up yet. Add the SPLITWISE_API_KEY secret, or SPLITWISE_CLIENT_ID, SPLITWISE_CLIENT_SECRET, and SPLITWISE_REFRESH_TOKEN.',
    }
  }

  let response: Response
  try {
    response = await fetch('https://secure.splitwise.com/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
      }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch (error) {
    console.error('sync-splitwise token refresh failed', logSafe(error instanceof Error ? error.message : 'fetch failed'))
    return { error: 'Splitwise did not refresh the OAuth token. You can use SPLITWISE_API_KEY instead.' }
  }

  const body = asRecord(await response.json().catch(() => null))
  const access = typeof body?.access_token === 'string' ? body.access_token.trim() : ''
  const nextRefresh = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : ''
  if (nextRefresh && nextRefresh !== refresh) {
    console.error('sync-splitwise Splitwise returned a replacement refresh token. Update SPLITWISE_REFRESH_TOKEN.')
  }
  if (!response.ok || !access) {
    console.error('sync-splitwise token refresh status', response.status)
    return { error: 'Splitwise did not refresh the OAuth token. Check the OAuth secrets, or use SPLITWISE_API_KEY instead.' }
  }
  return { token: access }
}

async function splitwiseGet(token: string, path: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(`${SPLITWISE_API}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  })
  const body = asRecord(await response.json().catch(() => null))
  return { status: response.status, body }
}

function splitwiseFailure(status: number, fallback: string): string {
  if (status === 401) return 'Splitwise rejected the API key or refresh token.'
  if (status === 403) return 'Splitwise refused this account.'
  if (status === 404) return fallback
  if (status === 429) return 'Splitwise rate limit. Wait a few minutes, then refresh again.'
  return 'Splitwise did not respond. Try again.'
}

function configuredGroupId(): number | null | 'invalid' {
  const raw = (Deno.env.get('SPLITWISE_GROUP_ID') ?? '').trim()
  if (!raw) return null
  const id = positiveId(raw)
  return id ?? 'invalid'
}

async function resolveGroup(
  token: string,
): Promise<{ id: number; name: string } | { error: string }> {
  const configured = configuredGroupId()
  if (configured === 'invalid') {
    return { error: 'SPLITWISE_GROUP_ID must be the number from the Splitwise group URL, not 0.' }
  }
  if (typeof configured === 'number') return { id: configured, name: 'Splitwise group' }

  const listed = await splitwiseGet(token, '/get_groups')
  if (listed.status !== 200 || !listed.body || !Array.isArray(listed.body.groups)) {
    return { error: splitwiseFailure(listed.status, 'Splitwise did not list groups.') }
  }
  const groups = listed.body.groups.flatMap((item) => {
    const group = asRecord(item)
    const id = positiveId(group?.id)
    if (!group || id === null) return []
    const name = typeof group.name === 'string' ? group.name.trim() : ''
    return [{ id, name, label: cleanLabel(name, 80, 'Group') }]
  })
  const wanted = (Deno.env.get('SPLITWISE_GROUP_NAME') ?? '').trim().toLowerCase()
  if (wanted) {
    const matches = groups.filter((group) => group.name.toLowerCase() === wanted)
    if (matches.length === 1) return { id: matches[0]!.id, name: cleanLabel(matches[0]!.name, 200, 'Splitwise group') }
    if (matches.length > 1) {
      return { error: `More than one Splitwise group is named "${cleanLabel(wanted, 80, 'that name')}". Set SPLITWISE_GROUP_ID.` }
    }
    return { error: `No Splitwise group is named "${cleanLabel(wanted, 80, 'that name')}". Set SPLITWISE_GROUP_ID.` }
  }
  const lines = groups.slice(0, 30).map((group) => `${group.id} ${group.label}`)
  const suffix = lines.length > 0 ? ` Groups this account can see: ${lines.join('; ')}.` : ''
  return { error: `Set SPLITWISE_GROUP_ID to the Cheetahs group. The id is the number in https://secure.splitwise.com/groups/<id>.${suffix}`.slice(0, 500) }
}

async function loadClubProfiles(admin: AdminClient): Promise<ClubProfile[] | { error: string }> {
  const names = new Map<string, string | null>()
  for (let from = 0; from < 2000; from += 500) {
    const result = await admin.from('profiles').select('id, full_name').range(from, from + 499)
    if (result.error) return { error: 'Could not read club profiles.' }
    const rows = result.data ?? []
    for (const row of rows) {
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)) continue
      names.set(row.id, typeof row.full_name === 'string' ? row.full_name : null)
    }
    if (rows.length < 500) break
  }

  const profiles: ClubProfile[] = []
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (result.error) return { error: 'Could not read club emails for the Splitwise match.' }
    const users = result.data.users
    for (const user of users) {
      if (!UUID_PATTERN.test(user.id) || !names.has(user.id)) continue
      const email = normalizeEmail(user.email)
      const named = cleanLabel(names.get(user.id), 120, '')
      const local = email ? email.split('@')[0] : ''
      profiles.push({
        id: user.id,
        email,
        displayName: named || cleanLabel(local, 120, 'Member'),
      })
    }
    if (users.length < 200) break
  }
  return profiles
}

function memberFromApi(value: unknown, emailToProfile: Map<string, string>): GroupMember | null | 'bad-balance' {
  const row = asRecord(value)
  const id = positiveId(row?.id)
  if (!row || id === null) return null
  const parsed = usdBalanceCents(row.balance)
  if (!parsed) return 'bad-balance'
  const email = normalizeEmail(row.email)
  return {
    id,
    email,
    displayName: personName(row.first_name, row.last_name, 'Splitwise member'),
    balanceCents: parsed.cents,
    profileId: email ? emailToProfile.get(email) ?? null : null,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const forceResult = await readForce(req)
  if (forceResult instanceof Response) return forceResult
  const authResult = await authorize(req)
  if (authResult instanceof Response) return authResult

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Could not refresh Splitwise.' })

  const skippedAt =
    authResult.service && forceResult.bypass ? null : await freshSyncedAt(admin, forceResult.force)
  if (skippedAt) return json(req, 200, { ok: true, skipped: true, synced_at: skippedAt })

  const tokenResult = await splitwiseToken()
  if ('error' in tokenResult) {
    await noteSyncError(admin, tokenResult.error)
    return json(req, 503, { error: tokenResult.error })
  }

  let group: { id: number; name: string }
  try {
    const resolved = await resolveGroup(tokenResult.token)
    if ('error' in resolved) {
      await noteSyncError(admin, resolved.error)
      return json(req, 502, { error: resolved.error })
    }
    group = resolved
  } catch (error) {
    console.error('sync-splitwise group lookup failed', logSafe(error instanceof Error ? error.message : 'fetch failed'))
    const message = 'Splitwise did not respond. Try again.'
    await noteSyncError(admin, message)
    return json(req, 502, { error: message })
  }

  let groupBody: Record<string, unknown> | null = null
  let expenseBody: Record<string, unknown> | null = null
  try {
    const [loaded, expenses] = await Promise.all([
      splitwiseGet(tokenResult.token, `/get_group/${group.id}`),
      splitwiseGet(tokenResult.token, `/get_expenses?group_id=${group.id}&limit=50`),
    ])
    if (loaded.status !== 200 || expenses.status !== 200) {
      const status = loaded.status !== 200 ? loaded.status : expenses.status
      const message = splitwiseFailure(
        status,
        loaded.status !== 200 ? 'Splitwise did not find that group.' : 'Splitwise did not list expenses.',
      )
      await noteSyncError(admin, message)
      return json(req, status === 429 ? 429 : 502, { error: message })
    }
    groupBody = loaded.body
    expenseBody = expenses.body
  } catch (error) {
    console.error('sync-splitwise fetch failed', logSafe(error instanceof Error ? error.message : 'fetch failed'))
    const message = 'Splitwise did not respond. Try again.'
    await noteSyncError(admin, message)
    return json(req, 502, { error: message })
  }

  const groupRecord = asRecord(groupBody?.group)
  const membersRaw = groupRecord?.members
  if (!groupRecord || !Array.isArray(membersRaw)) {
    const message = 'Splitwise did not return group members.'
    await noteSyncError(admin, message)
    return json(req, 502, { error: message })
  }

  const profiles = await loadClubProfiles(admin)
  if ('error' in profiles) {
    await noteSyncError(admin, profiles.error)
    return json(req, 500, { error: profiles.error })
  }
  const emailToProfile = new Map<string, string>()
  for (const profile of profiles) {
    if (profile.email && !emailToProfile.has(profile.email)) emailToProfile.set(profile.email, profile.id)
  }

  const members: GroupMember[] = []
  const seen = new Set<number>()
  const nonUsd = new Set<string>()
  for (const item of membersRaw) {
    const parsedBalance = usdBalanceCents(asRecord(item)?.balance)
    parsedBalance?.nonUsd.forEach((code) => nonUsd.add(code))
    const member = memberFromApi(item, emailToProfile)
    if (member === 'bad-balance') {
      const message = 'Splitwise returned a balance that is not a dollar amount.'
      await noteSyncError(admin, message)
      return json(req, 502, { error: message })
    }
    if (!member || seen.has(member.id)) continue
    seen.add(member.id)
    members.push(member)
  }
  if (members.length > 300) {
    const message = 'That Splitwise group has more than 300 members.'
    await noteSyncError(admin, message)
    return json(req, 502, { error: message })
  }

  const profileBySplitwise = new Map(members.map((member) => [member.id, member.profileId]))
  const expenses = buildExpenses(expenseBody?.expenses, profileBySplitwise)
  const currentUser = await splitwiseGet(tokenResult.token, '/get_current_user').catch(() => null)
  const account = asRecord(currentUser?.body?.user)
  const venmo = sanitizeVenmoUsername(Deno.env.get('VENMO_USERNAME') ?? '') ?? VENMO_PLACEHOLDER
  const mapped = new Set(members.flatMap((member) => (member.profileId ? [member.profileId] : [])))
  const unmatched = profiles
    .filter((profile) => !mapped.has(profile.id))
    .slice(0, 30)
    .map((profile) => ({
      profile_id: profile.id,
      display_name: profile.displayName.slice(0, 80),
      email: profile.email,
    }))

  const debts = buildDebts(groupRecord.simplified_debts, profileBySplitwise)
  const syncedAt = new Date().toISOString()
  const payload = {
    mode: 'replace',
    group_id: group.id,
    group_name: cleanLabel(groupRecord.name, 200, group.name),
    venmo_username: venmo,
    synced_at: syncedAt,
    account_label: personName(account?.first_name, account?.last_name, ''),
    detail: {
      venmo_placeholder: venmo === VENMO_PLACEHOLDER,
      non_usd: [...nonUsd].slice(0, 12),
      unmatched_profiles: unmatched,
      unmatched_truncated: profiles.filter((profile) => !mapped.has(profile.id)).length > unmatched.length,
      skipped_expenses: expenses.skipped,
    },
    balances: members.map((member) => ({
      splitwise_user_id: member.id,
      profile_id: member.profileId,
      email: member.email,
      display_name: member.displayName,
      balance_cents: member.balanceCents,
    })),
    debts,
    expenses: expenses.rows,
    shares: expenses.shares,
  }
  if (!payload.account_label) payload.account_label = ''

  const saved = await admin.rpc('replace_splitwise_snapshot', { payload })
  if (saved.error) {
    console.error('sync-splitwise save failed', logSafe(saved.error.message))
    return json(req, 500, { error: 'The Splitwise copy could not be saved.' })
  }
  const summary = asRecord(saved.data) ?? {}
  return json(req, 200, {
    ok: true,
    skipped: false,
    group_name: typeof summary.group_name === 'string' ? summary.group_name : payload.group_name,
    synced_at: syncedAt,
    mapped_count: summary.mapped_count ?? mapped.size,
    unmapped_count: summary.unmapped_count ?? members.filter((member) => !member.profileId).length,
    owed_by_members_cents: summary.owed_by_members_cents ?? null,
  })
})

function buildDebts(
  value: unknown,
  profileBySplitwise: Map<number, string | null>,
): {
  from_splitwise_user_id: number
  to_splitwise_user_id: number
  from_profile_id: string | null
  to_profile_id: string | null
  amount_cents: number
}[] {
  if (!Array.isArray(value)) return []
  const debts = []
  for (const item of value) {
    const row = asRecord(item)
    if (!row) continue
    const code = typeof row.currency_code === 'string' ? row.currency_code.trim().toUpperCase() : 'USD'
    if (code !== 'USD') continue
    const fromId = positiveId(row.from)
    const toId = positiveId(row.to)
    const amount = moneyToCents(row.amount)
    if (fromId === null || toId === null || amount === null || amount <= 0) continue
    debts.push({
      from_splitwise_user_id: fromId,
      to_splitwise_user_id: toId,
      from_profile_id: profileBySplitwise.get(fromId) ?? null,
      to_profile_id: profileBySplitwise.get(toId) ?? null,
      amount_cents: amount,
    })
    if (debts.length >= 1000) break
  }
  return debts
}

function buildExpenses(
  value: unknown,
  profileBySplitwise: Map<number, string | null>,
): {
  skipped: number
  rows: {
    splitwise_expense_id: number
    description: string
    cost_cents: number
    expense_at: string
    is_payment: boolean
  }[]
  shares: {
    splitwise_expense_id: number
    splitwise_user_id: number
    profile_id: string | null
    paid_cents: number
    owed_cents: number
  }[]
} {
  if (!Array.isArray(value)) return { skipped: 0, rows: [], shares: [] }
  const prepared = []
  const seen = new Set<number>()
  let skipped = 0
  for (const item of value) {
    const row = asRecord(item)
    if (!row) {
      skipped += 1
      continue
    }
    if (row.deleted_at) continue
    const code = typeof row.currency_code === 'string' ? row.currency_code.trim().toUpperCase() : ''
    if (code !== 'USD') {
      skipped += 1
      continue
    }
    const id = positiveId(row.id)
    const cost = moneyToCents(row.cost)
    const when = typeof row.date === 'string' ? row.date : typeof row.created_at === 'string' ? row.created_at : ''
    if (id === null || cost === null || cost < 0 || Number.isNaN(new Date(when).getTime()) || seen.has(id)) {
      skipped += 1
      continue
    }
    seen.add(id)
    const shares = []
    const users = Array.isArray(row.users) ? row.users : []
    for (const share of users) {
      const shareRow = asRecord(share)
      const userId = positiveId(shareRow?.user_id)
      const paid = moneyToCents(shareRow?.paid_share)
      const owed = moneyToCents(shareRow?.owed_share)
      if (userId === null || paid === null || owed === null || paid < 0 || owed < 0) continue
      shares.push({
        splitwise_expense_id: id,
        splitwise_user_id: userId,
        profile_id: profileBySplitwise.get(userId) ?? null,
        paid_cents: paid,
        owed_cents: owed,
      })
      if (shares.length >= 80) break
    }
    prepared.push({
      at: new Date(when).getTime(),
      row: {
        splitwise_expense_id: id,
        description: cleanLabel(row.description, 240, 'Splitwise expense'),
        cost_cents: cost,
        expense_at: new Date(when).toISOString(),
        is_payment: row.payment === true,
      },
      shares,
    })
  }
  prepared.sort((a, b) => b.at - a.at)
  const kept = prepared.slice(0, 40)
  skipped += prepared.length - kept.length
  return {
    skipped,
    rows: kept.map((item) => item.row),
    shares: kept.flatMap((item) => item.shares),
  }
}
