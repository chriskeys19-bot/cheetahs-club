import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import {
  echoFetch,
  interpretSheetResponse,
  isAllowedSheetUrl,
  readSyncRequest,
  scrubSheetError,
  secretsMatch,
  sheetRequestBody,
  sheetRowFromFeedback,
  type SheetRow,
} from './logic.ts'

// Copies public.feedback onto the club Google Sheet. The browser never calls
// this. pg_net does, with the Vault secret, after an insert and again from
// the hourly retry. A sheet failure leaves the row unsynced. Saving feedback
// does not wait on this function.
//
// Setup: docs/feedback-sync.md

const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'
const BATCH = 25
const BUDGET_MS = 40_000

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-feedback-sync',
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
  const result = await admin.rpc('feedback_sheet_target')
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

async function authorize(req: Request, secret: string): Promise<boolean> {
  const header = (req.headers.get('x-feedback-sync') ?? '').trim()
  if (secretsMatch(header, secret)) return true
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
  if (jwt && serviceKey && secretsMatch(jwt, serviceKey)) return true
  return isAdmin(jwt)
}

async function loadPending(admin: AdminClient, limit: number, feedbackId: string | null): Promise<unknown[]> {
  const result = await admin.rpc('feedback_sheet_pending', { p_limit: limit, p_id: feedbackId })
  if (result.error || !Array.isArray(result.data)) return []
  return result.data
}

async function mark(admin: AdminClient, id: string, ok: boolean, error: string | null): Promise<void> {
  const result = await admin.rpc('feedback_sheet_result', { p_id: id, p_ok: ok, p_error: error })
  if (result.error) console.error('feedback sheet mark failed', scrubSheetError(result.error.message).slice(0, 180))
}

async function postSheet(url: string, body: string): Promise<{ status: number; json: unknown }> {
  const first = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  let response = first
  if (first.status >= 300 && first.status < 400) {
    const follow = echoFetch(url, first.status, first.headers.get('location'))
    if (!follow) return { status: 502, json: null }
    response = await fetch(follow.url, {
      method: follow.method,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
  }
  return { status: response.status, json: await response.json().catch(() => null) }
}

async function pushRows(admin: AdminClient, target: SheetTarget, records: unknown[]): Promise<{ synced: number; failed: number }> {
  const rows: SheetRow[] = []
  let failed = 0
  for (const record of records) {
    const row = sheetRowFromFeedback(record)
    if (!row) {
      const id = record && typeof record === 'object' && typeof (record as { id?: unknown }).id === 'string'
        ? (record as { id: string }).id
        : ''
      if (id) {
        await mark(admin, id, false, 'This feedback row could not be sent.')
        failed += 1
      }
      continue
    }
    rows.push(row)
  }
  if (rows.length === 0) return { synced: 0, failed }
  let posted: { status: number; json: unknown }
  try {
    posted = await postSheet(target.url, sheetRequestBody(target.secret, rows))
  } catch (error) {
    const message = scrubSheetError(error instanceof Error ? error.message : 'The sheet could not be reached.')
    for (const row of rows) await mark(admin, row.id, false, message || 'The sheet could not be reached.')
    return { synced: 0, failed: failed + rows.length }
  }
  const results = interpretSheetResponse(posted.status, posted.json, rows.map((row) => row.id))
  let synced = 0
  for (const result of results) {
    await mark(admin, result.id, result.ok, result.error)
    if (result.ok) synced += 1
    else failed += 1
  }
  return { synced, failed }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const text = await req.text()
  if (text.length > 4000) return json(req, 413, { error: 'Request is too large.' })
  let body: unknown
  try {
    body = text.trim() ? JSON.parse(text) : {}
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }
  const parsed = readSyncRequest(body)
  if (typeof parsed === 'string') return json(req, 400, { error: parsed })

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Could not sync feedback.' })
  const target = await sheetTarget(admin)
  if (!target) return json(req, 500, { error: 'Feedback sheet sync is not on the database yet.' })
  if (!(await authorize(req, target.secret))) return json(req, 401, { error: 'Not allowed.' })

  const configured = isAllowedSheetUrl(target.url) && target.secret.length >= 16
  if (!configured) {
    console.error('feedback sheet url or secret is not in Vault yet')
    return json(req, 200, { ok: true, configured: false, synced: 0, failed: 0 })
  }

  if (!parsed.backfill) {
    const pending = await loadPending(admin, 1, parsed.feedbackId)
    if (pending.length === 0) return json(req, 200, { ok: true, configured: true, synced: 0, failed: 0, skipped: true })
    const outcome = await pushRows(admin, target, pending)
    return json(req, 200, { ok: true, configured: true, ...outcome })
  }

  const started = Date.now()
  let synced = 0
  let failed = 0
  while (Date.now() - started < BUDGET_MS) {
    const pending = await loadPending(admin, BATCH, null)
    if (pending.length === 0) break
    const outcome = await pushRows(admin, target, pending)
    synced += outcome.synced
    failed += outcome.failed
    if (outcome.synced === 0 || pending.length < BATCH) break
  }
  return json(req, 200, { ok: true, configured: true, synced, failed })
})
