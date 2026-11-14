import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import { echoFetch, isAllowedSheetUrl, scrubSheetError, secretsMatch } from '../sync-feedback-sheet/logic.ts'
import {
  interpretFinanceSheet,
  readFinanceRequest,
  relinkPayload,
  replacePayload,
  sheetReadBody,
  type FinanceSource,
} from './logic.ts'
import type { NameMap, RosterPerson } from '../../../src/lib/sheetLedger.ts'

// Copies the winter finance sheet into RLS-safe tables. The browser never
// talks to Google. pg_cron POSTs with x-finance-sync, and an admin can POST
// with their JWT. The Apps Script is read-only. Setup: docs/finance-sheet.md

const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'

const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

type AdminClient = SupabaseClient

type SheetTarget = {
  url: string
  secret: string
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-finance-sync',
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

function adminClient(): AdminClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function sheetTarget(admin: AdminClient): Promise<SheetTarget | null> {
  const result = await admin.rpc('finance_sheet_target')
  if (result.error || !result.data || typeof result.data !== 'object') return null
  const row = result.data as { url?: unknown; secret?: unknown }
  return {
    url: typeof row.url === 'string' ? row.url.trim() : '',
    secret: typeof row.secret === 'string' ? row.secret.trim() : '',
  }
}

async function isAdmin(jwt: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey || jwt.split('.').length !== 3) return false
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user) return false
  const profile = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return !profile.error && profile.data?.role === 'admin'
}

async function authorize(req: Request, secret: string): Promise<FinanceSource | Response> {
  const header = (req.headers.get('x-finance-sync') ?? '').trim()
  if (header) {
    if (secretsMatch(header, secret)) return 'scheduled'
    return json(req, 401, { error: 'Not allowed.' })
  }
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (await isAdmin(jwt)) return 'manual'
  return json(req, 401, { error: 'Sign in as an admin, then sync.' })
}

function safeError(message: string, secret: string): string {
  const scrubbed = scrubSheetError(message) || 'The sheet could not be read.'
  if (!secret) return scrubbed
  return scrubbed.split(secret).join('[secret]')
}

async function loadPeople(admin: AdminClient): Promise<{ roster: RosterPerson[]; maps: NameMap[] } | null> {
  const [profiles, maps] = await Promise.all([
    admin.from('profiles').select('id, full_name').limit(1000),
    admin.from('sheet_name_map').select('sheet_key, profile_id').limit(500),
  ])
  if (profiles.error || maps.error) return null
  const roster: RosterPerson[] = []
  if (Array.isArray(profiles.data)) {
    for (const row of profiles.data) {
      if (!row || typeof row !== 'object') continue
      const record = row as { id?: unknown; full_name?: unknown }
      if (typeof record.id !== 'string') continue
      roster.push({
        id: record.id,
        fullName: typeof record.full_name === 'string' ? record.full_name : null,
      })
    }
  }
  const nameMaps: NameMap[] = []
  if (Array.isArray(maps.data)) {
    for (const row of maps.data) {
      if (!row || typeof row !== 'object') continue
      const record = row as { sheet_key?: unknown; profile_id?: unknown }
      if (typeof record.sheet_key !== 'string' || typeof record.profile_id !== 'string') continue
      nameMaps.push({ sheetKey: record.sheet_key, profileId: record.profile_id })
    }
  }
  return { roster, maps: nameMaps }
}

async function recordError(admin: AdminClient, message: string): Promise<void> {
  const result = await admin.rpc('replace_finance_sheet', {
    payload: { mode: 'error', sync_error: message },
  })
  if (result.error) console.error('finance sheet error mark failed', safeError(result.error.message, '').slice(0, 180))
}

async function readSheet(url: string, secret: string): Promise<{ status: number; json: unknown }> {
  const first = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: sheetReadBody(secret),
    signal: AbortSignal.timeout(20_000),
  })
  let response = first
  if (first.status >= 300 && first.status < 400) {
    const follow = echoFetch(url, first.status, first.headers.get('location'))
    if (!follow) return { status: 502, json: { error: 'The sheet redirect was not accepted.' } }
    response = await fetch(follow.url, {
      method: follow.method,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
  }
  const text = await response.text()
  if (text.length > 2_000_000) return { status: 502, json: { error: 'The sheet response was too large.' } }
  try {
    return { status: response.status, json: text.trim() ? JSON.parse(text) : null }
  } catch {
    return { status: response.status, json: { error: 'The sheet did not return JSON.' } }
  }
}

async function relink(admin: AdminClient, people: { roster: RosterPerson[]; maps: NameMap[] }): Promise<Response | Record<string, unknown>> {
  const [accounts, charges] = await Promise.all([
    admin.from('sheet_dues_accounts').select('sheet_key, sheet_name').limit(300),
    admin.from('sheet_dues_charges').select('sheet_key, sheet_name').limit(8000),
  ])
  if (accounts.error || charges.error) return { error: 'Could not read the stored sheet.' }
  const names = (rows: unknown) => {
    if (!Array.isArray(rows)) return []
    const parsed: { sheetKey: string; sheetName: string }[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as { sheet_key?: unknown; sheet_name?: unknown }
      if (typeof record.sheet_key !== 'string' || typeof record.sheet_name !== 'string') continue
      parsed.push({ sheetKey: record.sheet_key, sheetName: record.sheet_name })
    }
    return parsed
  }
  const payload = relinkPayload(names(accounts.data), names(charges.data), people.roster, people.maps)
  const result = await admin.rpc('relink_finance_sheet', { payload })
  if (result.error) return { error: safeError(result.error.message, '') }
  return { ok: true, rematch: true, ...(result.data && typeof result.data === 'object' ? result.data : {}) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const text = await req.text()
  if (text.length > 4000) return json(req, 413, { error: 'Request is too large.' })
  let body: unknown = {}
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      return json(req, 400, { error: 'Send JSON.' })
    }
  }
  const parsed = readFinanceRequest(body)
  if (typeof parsed === 'string') return json(req, 400, { error: parsed })

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Could not sync the club sheet.' })
  const target = await sheetTarget(admin)
  if (!target) return json(req, 500, { error: 'Club dues are not on the database yet.' })
  const auth = await authorize(req, target.secret)
  if (auth instanceof Response) return auth

  const people = await loadPeople(admin)
  if (!people) return json(req, 500, { error: 'Could not read the member list.' })

  if (parsed.rematch) {
    if (auth !== 'manual') return json(req, 403, { error: 'An admin links sheet names.' })
    const linked = await relink(admin, people)
    if ('error' in linked && typeof linked.error === 'string') return json(req, 500, { error: linked.error })
    return json(req, 200, linked)
  }

  const configured = isAllowedSheetUrl(target.url) && target.secret.length >= 16
  if (!configured) {
    console.error('finance sheet url or secret is not in Vault yet')
    return json(req, 200, { ok: true, configured: false })
  }

  let posted: { status: number; json: unknown }
  try {
    posted = await readSheet(target.url, target.secret)
  } catch (error) {
    const message = safeError(error instanceof Error ? error.message : 'The sheet could not be reached.', target.secret)
    await recordError(admin, message)
    return json(req, 200, { ok: false, error: message })
  }

  const ledger = interpretFinanceSheet(posted.status, posted.json)
  if ('error' in ledger) {
    const message = safeError(ledger.error, target.secret)
    await recordError(admin, message)
    return json(req, 200, { ok: false, error: message })
  }

  const payload = replacePayload(
    ledger.accounts,
    ledger.charges,
    ledger.names,
    people.roster,
    people.maps,
    new Date().toISOString(),
    auth,
  )
  const saved = await admin.rpc('replace_finance_sheet', { payload })
  if (saved.error) {
    const message = safeError(saved.error.message, target.secret)
    await recordError(admin, message)
    return json(req, 200, { ok: false, error: 'The club sheet could not be saved.' })
  }
  return json(req, 200, { ok: true, configured: true, ...(saved.data && typeof saved.data === 'object' ? saved.data : {}) })
})
