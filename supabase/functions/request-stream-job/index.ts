import { createClient } from 'npm:@supabase/supabase-js@2.81.1'
import { readJobId, readStreamJobRequest, webhookCall } from './logic.ts'

const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'
const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

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

async function postWebhook(call: { url: string; headers: Record<string, string>; body: string }): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(call.url, {
      method: 'POST',
      headers: call.headers,
      body: call.body,
      signal: controller.signal,
    })
    return response.ok
  } catch (error) {
    const message = error instanceof Error ? error.message : 'webhook failed'
    console.error('stream webhook post failed', message.slice(0, 180))
    return false
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt || jwt.split('.').length !== 3) {
    return json(req, 401, { error: 'Sign in again, then try the stream.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) {
    return json(req, 500, { error: 'Streams are not available right now.' })
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const userResult = await supabase.auth.getUser(jwt)
  if (userResult.error || !userResult.data.user) {
    return json(req, 401, { error: 'Sign in again, then try the stream.' })
  }

  const text = await req.text()
  if (text.length > 4000) return json(req, 413, { error: 'That stream request is too large.' })
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }

  const parsed = readStreamJobRequest(body)
  if (typeof parsed === 'string') return json(req, 400, { error: parsed })

  // The RPC rejects a manual end unless the caller is a captain or admin.
  // A completed game stays open to any signed-in member so automatic end still works.
  const queued = await supabase.rpc('request_stream_job', {
    p_schedule_event_id: parsed.scheduleEventId,
    p_action: parsed.action,
    p_payload: parsed.payload,
  })
  if (queued.error) {
    const message = queued.error.message || 'The stream job could not be queued.'
    const status = /sign in/i.test(message) ? 401 : /admin|captain|cannot|staff/i.test(message) ? 403 : 400
    return json(req, status, { error: message })
  }

  const jobId = readJobId(queued.data)
  if (!jobId) return json(req, 500, { error: 'The stream job did not return an id.' })

  const call = webhookCall(Deno.env.get('STREAM_WEBHOOK_URL'), Deno.env.get('STREAM_WEBHOOK_KEY'), jobId)
  if (!call) {
    return json(req, 200, { job_id: jobId, delivery: 'queued' })
  }

  const posted = await postWebhook(call)
  return json(req, 200, { job_id: jobId, delivery: posted ? 'sent' : 'queued' })
})
