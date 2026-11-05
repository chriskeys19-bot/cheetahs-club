import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'

export const TOKEN_PATTERN = /^[0-9a-f]{64}$/

const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

export type InviteRow = {
  id: string
  email: string
  status: string
  expires_at: string
  team_id: string | null
  role_intended: string
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://cheetahs-club.pages.dev'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export function adminClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export async function readBody(req: Request): Promise<unknown | Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })
  if (!req.headers.get('apikey')) return json(req, 401, { error: 'Missing API key.' })

  const text = await req.text()
  if (text.length > 8000) return json(req, 413, { error: 'Request is too large.' })
  try {
    return JSON.parse(text) as unknown
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }
}

export function tokenFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const token = (body as Record<string, unknown>).token
  if (typeof token !== 'string') return null
  const normalized = token.trim().toLowerCase()
  if (!TOKEN_PATTERN.test(normalized)) return null
  return normalized
}

function isInviteRow(value: unknown): value is InviteRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.email === 'string' &&
    typeof row.status === 'string' &&
    typeof row.expires_at === 'string' &&
    (row.team_id === null || typeof row.team_id === 'string') &&
    typeof row.role_intended === 'string'
  )
}

export async function loadInvite(
  req: Request,
  admin: SupabaseClient,
  token: string,
): Promise<{ invite: InviteRow } | { error: Response }> {
  const { data, error } = await admin
    .from('invites')
    .select('id, email, status, expires_at, team_id, role_intended')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    console.error('invite lookup failed', error.code)
    return { error: json(req, 500, { error: 'The invite could not be checked. Try again.' }) }
  }
  if (!isInviteRow(data)) return { error: json(req, 404, { error: 'This join link is not valid.' }) }
  if (data.role_intended !== 'player') {
    return { error: json(req, 404, { error: 'This join link is not valid.' }) }
  }
  if (data.status === 'revoked') {
    return {
      error: json(req, 410, { error: 'This invite was revoked. Ask a captain for a new link.' }),
    }
  }
  if (data.status === 'accepted') {
    return {
      error: json(req, 409, { error: 'This invite has already been used. Sign in instead.' }),
    }
  }
  if (data.status !== 'pending') {
    return { error: json(req, 404, { error: 'This join link is not valid.' }) }
  }

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    const { error: expireError } = await admin
      .from('invites')
      .update({ status: 'expired' })
      .eq('id', data.id)
      .eq('status', 'pending')
    if (expireError) console.error('invite expire failed', data.id)
    return {
      error: json(req, 410, { error: 'This invite has expired. Ask a captain for a new link.' }),
    }
  }

  return { invite: data }
}
