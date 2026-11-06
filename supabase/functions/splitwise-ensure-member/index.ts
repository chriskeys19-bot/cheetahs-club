import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import {
  cleanLabel,
  ensureOnCooldown,
  groupMemberRefs,
  interpretAddUser,
  memberIdForEmail,
  normalizeEmail,
  scrubSecret,
  splitPersonName,
  SPLITWISE_ADD_FAILED_MESSAGE,
  SPLITWISE_GROUP_MISSING_MESSAGE,
  SPLITWISE_RATE_LIMIT_MESSAGE,
  SPLITWISE_UNAUTHORIZED_MESSAGE,
  SPLITWISE_UNAVAILABLE_MESSAGE,
  type GroupMemberRef,
} from '../_shared/splitwise.ts'

// Adds the signed-in member to the Cheetahs Splitwise group when their
// sign-in email is not already there. An admin can send { "all": true } to
// run the same check for every profile. The API key stays in this function.
// Successful rows are stored on splitwise_membership so the next page load
// does not call Splitwise. A failure waits ten minutes.
//
// verify_jwt is on. The handler still calls getUser and reads profiles.role
// from the database. user_metadata is only a display-name fallback.

const SPLITWISE_API = 'https://secure.splitwise.com/api/v3.0'
const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_POSTS = 40
const DEADLINE_MS = 25_000
const POST_GAP_MS = 250
const FAILURE_CAP = 12
const extraSecrets: string[] = []

const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

type AdminClient = SupabaseClient

type ClubAccount = {
  id: string
  email: string | null
  fullName: string | null
  metadata: Record<string, unknown> | null
  role: string | null
}

type MembershipState = {
  exists: boolean
  splitwiseUserId: number | null
  addedAt: string | null
  lastError: string | null
  lastAttemptAt: string | null
}

type EnsureOutcome =
  | { status: 'added' | 'already_member'; userId: number }
  | { status: 'failed'; message: string }
  | { status: 'rate_limit'; message: string }
  | { status: 'unauthorized'; message: string }

type FailureRow = {
  profile_id: string
  display_name: string
  email: string | null
  error: string
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function secretValues(): string[] {
  const values = [
    Deno.env.get('SPLITWISE_API_KEY') ?? '',
    Deno.env.get('SPLITWISE_CLIENT_SECRET') ?? '',
    Deno.env.get('SPLITWISE_REFRESH_TOKEN') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  ]
    .map((value) => value.trim())
    .filter((value) => value.length >= 8)
  for (const secret of extraSecrets) {
    if (!values.includes(secret)) values.push(secret)
  }
  return values
}

function logSafe(message: string): string {
  return scrubSecret(message, secretValues())
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function positiveGroupId(value: string): number | null {
  if (!/^[1-9]\d{0,14}$/.test(value)) return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return id
}

function adminClient(): AdminClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function readMode(req: Request): Promise<{ all: boolean } | Response> {
  const text = await req.text()
  if (text.length > 200) return json(req, 413, { error: 'Request is too large.' })
  if (!text.trim()) return { all: false }
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }
  const record = asRecord(body)
  if (!record) return json(req, 400, { error: 'Send JSON.' })
  if (record.all !== undefined && typeof record.all !== 'boolean') {
    return json(req, 400, { error: 'all must be true or false.' })
  }
  return { all: record.all === true }
}

async function callerId(req: Request): Promise<{ userId: string } | Response> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt || jwt.split('.').length !== 3) return json(req, 401, { error: 'Sign in, then try again.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return json(req, 500, { error: 'Could not add this member to Splitwise.' })

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user || !UUID_PATTERN.test(user.id)) {
    return json(req, 401, { error: 'Sign in, then try again.' })
  }
  return { userId: user.id }
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function accountFrom(id: string, fullName: unknown, email: unknown, metadata: unknown, role: unknown): ClubAccount {
  return {
    id,
    email: normalizeEmail(email),
    fullName: typeof fullName === 'string' ? fullName : null,
    metadata: metadataRecord(metadata),
    role: typeof role === 'string' ? role : null,
  }
}

// user_metadata is a display-name fallback for Google and invite signups.
// The role check uses profiles.role, never metadata.
function displayFullName(account: ClubAccount): string {
  const fromProfile = cleanLabel(account.fullName, 80, '')
  if (fromProfile) return fromProfile
  const meta = account.metadata
  const metaFull = cleanLabel(meta?.full_name, 80, '')
  if (metaFull) return metaFull
  const given = typeof meta?.given_name === 'string' ? meta.given_name : ''
  const family = typeof meta?.family_name === 'string' ? meta.family_name : ''
  return cleanLabel(`${given} ${family}`, 80, '')
}

function displayLabel(account: ClubAccount): string {
  const named = displayFullName(account)
  if (named) return named
  const local = account.email ? account.email.split('@')[0] ?? '' : ''
  return cleanLabel(local, 80, 'Member')
}

async function loadCaller(admin: AdminClient, userId: string): Promise<ClubAccount | { error: string; status: number }> {
  const profile = await admin.from('profiles').select('id, full_name, role').eq('id', userId).maybeSingle()
  if (profile.error) return { error: 'Could not read your club profile.', status: 500 }
  if (!profile.data || profile.data.id !== userId) {
    return { error: 'Your club profile is not ready yet. Try again in a moment.', status: 409 }
  }
  const authUser = await admin.auth.admin.getUserById(userId)
  if (authUser.error || !authUser.data.user) return { error: 'Could not read your sign-in email.', status: 500 }
  const user = authUser.data.user
  return accountFrom(userId, profile.data.full_name, user.email, user.user_metadata, profile.data.role)
}

async function loadClubAccounts(admin: AdminClient): Promise<ClubAccount[] | { error: string }> {
  const profiles = new Map<string, { fullName: string | null; role: string | null }>()
  for (let from = 0; from < 2000; from += 500) {
    const result = await admin.from('profiles').select('id, full_name, role').range(from, from + 499)
    if (result.error) return { error: 'Could not read club profiles.' }
    const rows = result.data ?? []
    for (const row of rows) {
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)) continue
      profiles.set(row.id, {
        fullName: typeof row.full_name === 'string' ? row.full_name : null,
        role: typeof row.role === 'string' ? row.role : null,
      })
    }
    if (rows.length < 500) break
  }

  const accounts: ClubAccount[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (result.error) return { error: 'Could not read club emails.' }
    const users = result.data.users
    for (const user of users) {
      if (!UUID_PATTERN.test(user.id)) continue
      const profile = profiles.get(user.id)
      if (!profile) continue
      seen.add(user.id)
      accounts.push(accountFrom(user.id, profile.fullName, user.email, user.user_metadata, profile.role))
    }
    if (users.length < 200) break
  }
  for (const [id, profile] of profiles) {
    if (seen.has(id)) continue
    accounts.push(accountFrom(id, profile.fullName, null, null, profile.role))
  }
  return accounts
}

async function readMembership(admin: AdminClient, profileId: string): Promise<MembershipState | { error: string }> {
  const result = await admin
    .from('splitwise_membership')
    .select('splitwise_user_id, splitwise_added_at, last_error, last_attempt_at')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (result.error) return { error: 'Could not read Splitwise membership. Apply the splitwise_membership migration.' }
  if (!result.data) {
    return { exists: false, splitwiseUserId: null, addedAt: null, lastError: null, lastAttemptAt: null }
  }
  const row = result.data
  const rawUserId = row.splitwise_user_id
  const parsedUserId =
    typeof rawUserId === 'number'
      ? rawUserId
      : typeof rawUserId === 'string' && /^[1-9]\d{0,14}$/.test(rawUserId)
        ? Number(rawUserId)
        : Number.NaN
  const userId = Number.isSafeInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null
  return {
    exists: true,
    splitwiseUserId: userId,
    addedAt: typeof row.splitwise_added_at === 'string' ? row.splitwise_added_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    lastAttemptAt: typeof row.last_attempt_at === 'string' ? row.last_attempt_at : null,
  }
}

async function writeMembership(
  admin: AdminClient,
  state: MembershipState,
  profileId: string,
  splitwiseUserId: number | null,
  addedAt: string | null,
  lastError: string | null,
): Promise<string | null> {
  const now = new Date().toISOString()
  let errorText: string | null = null
  if (lastError) {
    errorText = lastError.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)
    if (!errorText) errorText = SPLITWISE_ADD_FAILED_MESSAGE
  }
  const row = {
    splitwise_user_id: splitwiseUserId,
    splitwise_added_at: addedAt,
    last_error: errorText,
    last_attempt_at: now,
    updated_at: now,
  }
  const result = state.exists
    ? await admin.from('splitwise_membership').update(row).eq('profile_id', profileId).select('profile_id')
    : await admin.from('splitwise_membership').insert({ profile_id: profileId, ...row }).select('profile_id')
  if (result.error) {
    const duplicate = result.error.code === '23505'
    console.error('splitwise-ensure-member save failed', logSafe(result.error.message))
    if (duplicate) return 'That Splitwise member is already linked to another club account.'
    return 'Could not save the Splitwise membership.'
  }
  if (!result.data || result.data.length === 0) return 'Could not save the Splitwise membership.'
  state.exists = true
  state.splitwiseUserId = splitwiseUserId
  state.addedAt = addedAt
  state.lastError = lastError
  state.lastAttemptAt = now
  return null
}

async function splitwiseToken(): Promise<{ token: string } | { error: string }> {
  const apiKey = (Deno.env.get('SPLITWISE_API_KEY') ?? '').trim()
  if (apiKey) return { token: apiKey }

  const clientId = (Deno.env.get('SPLITWISE_CLIENT_ID') ?? '').trim()
  const clientSecret = (Deno.env.get('SPLITWISE_CLIENT_SECRET') ?? '').trim()
  const refresh = (Deno.env.get('SPLITWISE_REFRESH_TOKEN') ?? '').trim()
  if (!clientId || !clientSecret || !refresh) {
    return { error: 'Splitwise is not set up yet. Add the SPLITWISE_API_KEY secret.' }
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
    console.error('splitwise-ensure-member token refresh failed', logSafe(error instanceof Error ? error.message : 'fetch failed'))
    return { error: 'Splitwise did not refresh the OAuth token. You can use SPLITWISE_API_KEY instead.' }
  }

  const body = asRecord(await response.json().catch(() => null))
  const access = typeof body?.access_token === 'string' ? body.access_token.trim() : ''
  const nextRefresh = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : ''
  if (nextRefresh && nextRefresh !== refresh) {
    console.error('splitwise-ensure-member Splitwise returned a replacement refresh token. Update SPLITWISE_REFRESH_TOKEN.')
  }
  if (!response.ok || !access) {
    console.error('splitwise-ensure-member token refresh status', response.status)
    return { error: 'Splitwise did not refresh the OAuth token. Check the OAuth secrets, or use SPLITWISE_API_KEY instead.' }
  }
  if (access.length >= 8) extraSecrets.push(access)
  return { token: access }
}

function configuredGroupId(): number | { error: string } {
  const raw = (Deno.env.get('SPLITWISE_GROUP_ID') ?? '').trim()
  if (!raw) return { error: 'Set SPLITWISE_GROUP_ID to the Cheetahs group.' }
  const id = positiveGroupId(raw)
  if (id === null) return { error: 'SPLITWISE_GROUP_ID must be the number from the Splitwise group URL, not 0.' }
  return id
}

async function splitwiseSend(
  token: string,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null; failed: boolean }> {
  try {
    const response = await fetch(`${SPLITWISE_API}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    })
    const parsed = asRecord(await response.json().catch(() => null))
    return { status: response.status, body: parsed, failed: false }
  } catch (error) {
    console.error('splitwise-ensure-member request failed', method, logSafe(error instanceof Error ? error.message : 'fetch failed'))
    return { status: 0, body: null, failed: true }
  }
}

async function loadGroupMembers(
  token: string,
  groupId: number,
): Promise<{ members: GroupMemberRef[] } | { error: string; rateLimit: boolean; unauthorized: boolean }> {
  const loaded = await splitwiseSend(token, `/get_group/${groupId}`, 'GET')
  if (loaded.failed) return { error: SPLITWISE_UNAVAILABLE_MESSAGE, rateLimit: false, unauthorized: false }
  if (loaded.status === 429) return { error: SPLITWISE_RATE_LIMIT_MESSAGE, rateLimit: true, unauthorized: false }
  if (loaded.status === 401) return { error: SPLITWISE_UNAUTHORIZED_MESSAGE, rateLimit: false, unauthorized: true }
  if (loaded.status === 404) return { error: SPLITWISE_GROUP_MISSING_MESSAGE, rateLimit: false, unauthorized: false }
  if (loaded.status !== 200) return { error: SPLITWISE_UNAVAILABLE_MESSAGE, rateLimit: false, unauthorized: false }
  const membersRaw = asRecord(loaded.body?.group)?.members
  const parsed = groupMemberRefs(membersRaw)
  if (!parsed) return { error: 'Splitwise did not return group members.', rateLimit: false, unauthorized: false }
  if (parsed.truncated) return { error: 'That Splitwise group has more than 300 members.', rateLimit: false, unauthorized: false }
  return { members: parsed.members }
}

async function addAccount(
  token: string,
  groupId: number,
  account: ClubAccount,
  members: GroupMemberRef[],
): Promise<EnsureOutcome> {
  if (!account.email) return { status: 'failed', message: 'This account has no sign-in email.' }
  const present = memberIdForEmail(members, account.email)
  if (present !== null) return { status: 'already_member', userId: present }

  const names = splitPersonName(displayFullName(account), account.email)
  const posted = await splitwiseSend(token, '/add_user_to_group', 'POST', {
    group_id: groupId,
    email: account.email,
    first_name: names.firstName,
    last_name: names.lastName,
  })
  if (posted.failed) return { status: 'failed', message: SPLITWISE_UNAVAILABLE_MESSAGE }
  const interpreted = interpretAddUser(posted.status, posted.body, secretValues())
  if (interpreted.kind === 'added') return { status: 'added', userId: interpreted.userId }
  if (interpreted.kind === 'rate_limit') return { status: 'rate_limit', message: SPLITWISE_RATE_LIMIT_MESSAGE }
  if (interpreted.kind === 'unauthorized') return { status: 'unauthorized', message: interpreted.message }
  if (interpreted.kind === 'already') {
    const again = await loadGroupMembers(token, groupId)
    if ('error' in again) {
      if (again.rateLimit) return { status: 'rate_limit', message: again.error }
      if (again.unauthorized) return { status: 'unauthorized', message: again.error }
      return { status: 'failed', message: again.error }
    }
    const id = memberIdForEmail(again.members, account.email)
    if (id !== null) return { status: 'already_member', userId: id }
    return { status: 'failed', message: 'Splitwise says this email is already in the group, but the member list has no match.' }
  }
  return { status: 'failed', message: interpreted.message || SPLITWISE_ADD_FAILED_MESSAGE }
}

async function refreshSnapshot(): Promise<boolean> {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') ?? '').trim()
  if (!supabaseUrl || !serviceKey) return false
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-splitwise`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: anonKey || serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true, bypass: true }),
      signal: AbortSignal.timeout(25_000),
    })
    await response.arrayBuffer().catch(() => null)
    if (!response.ok) {
      console.error('splitwise-ensure-member refresh status', response.status)
      return false
    }
    return true
  } catch (error) {
    console.error('splitwise-ensure-member refresh failed', logSafe(error instanceof Error ? error.message : 'fetch failed'))
    return false
  }
}

function pushFailure(failures: FailureRow[], account: ClubAccount, message: string): void {
  if (failures.length >= FAILURE_CAP) return
  failures.push({
    profile_id: account.id,
    display_name: displayLabel(account),
    email: account.email,
    error: message.slice(0, 180),
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const mode = await readMode(req)
  if (mode instanceof Response) return mode
  const caller = await callerId(req)
  if (caller instanceof Response) return caller

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Could not add this member to Splitwise.' })

  const callerAccount = await loadCaller(admin, caller.userId)
  if ('error' in callerAccount) return json(req, callerAccount.status, { error: callerAccount.error })
  if (mode.all && callerAccount.role !== 'admin') {
    return json(req, 403, { error: 'Only an admin can add every member.' })
  }

  if (!mode.all) {
    const state = await readMembership(admin, callerAccount.id)
    if ('error' in state) return json(req, 500, { error: state.error })
    if (state.addedAt && state.splitwiseUserId) {
      return json(req, 200, {
        ok: true,
        status: 'already_recorded',
        splitwise_user_id: state.splitwiseUserId,
        synced: false,
      })
    }
    if (ensureOnCooldown(state.lastError, state.lastAttemptAt, Date.now())) {
      return json(req, 200, { ok: true, status: 'cooldown', synced: false })
    }
    if (!callerAccount.email) {
      const saved = await writeMembership(admin, state, callerAccount.id, state.splitwiseUserId, null, 'This account has no sign-in email.')
      return json(req, 422, { error: saved ?? 'This account has no sign-in email.' })
    }

    const tokenResult = await splitwiseToken()
    if ('error' in tokenResult) {
      await writeMembership(admin, state, callerAccount.id, state.splitwiseUserId, null, tokenResult.error)
      return json(req, 503, { error: tokenResult.error })
    }
    const groupId = configuredGroupId()
    if (typeof groupId !== 'number') {
      await writeMembership(admin, state, callerAccount.id, state.splitwiseUserId, null, groupId.error)
      return json(req, 503, { error: groupId.error })
    }
    const grouped = await loadGroupMembers(tokenResult.token, groupId)
    if ('error' in grouped) {
      await writeMembership(admin, state, callerAccount.id, state.splitwiseUserId, null, grouped.error)
      const status = grouped.rateLimit ? 429 : grouped.unauthorized ? 503 : 502
      return json(req, status, { error: grouped.error })
    }
    const outcome = await addAccount(tokenResult.token, groupId, callerAccount, grouped.members)
    if (outcome.status === 'added' || outcome.status === 'already_member') {
      const saved = await writeMembership(admin, state, callerAccount.id, outcome.userId, new Date().toISOString(), null)
      if (saved) return json(req, 500, { error: saved })
      const synced = await refreshSnapshot()
      return json(req, 200, {
        ok: true,
        status: outcome.status,
        splitwise_user_id: outcome.userId,
        synced,
      })
    }
    const message = outcome.message
    await writeMembership(admin, state, callerAccount.id, state.splitwiseUserId, null, message)
    const status = outcome.status === 'rate_limit' ? 429 : outcome.status === 'unauthorized' ? 503 : 502
    return json(req, status, { error: message })
  }

  const accounts = await loadClubAccounts(admin)
  if ('error' in accounts) return json(req, 500, { error: accounts.error })

  const tokenResult = await splitwiseToken()
  if ('error' in tokenResult) return json(req, 503, { error: tokenResult.error })
  const groupId = configuredGroupId()
  if (typeof groupId !== 'number') return json(req, 503, { error: groupId.error })
  const grouped = await loadGroupMembers(tokenResult.token, groupId)
  if ('error' in grouped) {
    const status = grouped.rateLimit ? 429 : grouped.unauthorized ? 503 : 502
    return json(req, status, { error: grouped.error })
  }

  let added = 0
  let alreadyMember = 0
  let alreadyRecorded = 0
  let failed = 0
  let skipped = 0
  let remaining = 0
  let rateLimited = false
  let changed = false
  const failures: FailureRow[] = []
  const seenEmails = new Set<string>()
  const queue: ClubAccount[] = []
  const deadline = Date.now() + DEADLINE_MS
  let posts = 0

  for (const account of accounts) {
    const state = await readMembership(admin, account.id)
    if ('error' in state) return json(req, 500, { error: state.error })
    if (state.addedAt) {
      alreadyRecorded += 1
      continue
    }
    if (!account.email) {
      skipped += 1
      continue
    }
    if (seenEmails.has(account.email)) {
      failed += 1
      pushFailure(failures, account, 'Another club account uses this email.')
      continue
    }
    seenEmails.add(account.email)
    const present = memberIdForEmail(grouped.members, account.email)
    if (present !== null) {
      const saved = await writeMembership(admin, state, account.id, present, new Date().toISOString(), null)
      if (saved) {
        failed += 1
        pushFailure(failures, account, saved)
      } else {
        alreadyMember += 1
        changed = true
      }
      continue
    }
    queue.push(account)
  }

  for (let index = 0; index < queue.length; index += 1) {
    const account = queue[index]!
    if (posts >= MAX_POSTS || Date.now() > deadline) {
      remaining = queue.length - index
      break
    }
    if (posts > 0) await sleep(POST_GAP_MS)
    posts += 1
    const state = await readMembership(admin, account.id)
    if ('error' in state) return json(req, 500, { error: state.error })
    const outcome = await addAccount(tokenResult.token, groupId, account, grouped.members)
    if (outcome.status === 'added' || outcome.status === 'already_member') {
      const saved = await writeMembership(admin, state, account.id, outcome.userId, new Date().toISOString(), null)
      if (saved) {
        failed += 1
        pushFailure(failures, account, saved)
      } else if (outcome.status === 'added') {
        added += 1
        changed = true
        grouped.members.push({ id: outcome.userId, email: account.email })
      } else {
        alreadyMember += 1
        changed = true
      }
      continue
    }
    failed += 1
    pushFailure(failures, account, outcome.message)
    await writeMembership(admin, state, account.id, state.splitwiseUserId, null, outcome.message)
    if (outcome.status === 'rate_limit' || outcome.status === 'unauthorized') {
      rateLimited = outcome.status === 'rate_limit'
      remaining += queue.length - index - 1
      break
    }
  }

  const synced = changed ? await refreshSnapshot() : false
  return json(req, 200, {
    ok: true,
    added,
    already_member: alreadyMember,
    already_recorded: alreadyRecorded,
    failed,
    skipped,
    remaining,
    rate_limited: rateLimited,
    synced,
    failures,
  })
})
