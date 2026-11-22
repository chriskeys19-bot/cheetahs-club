import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'

export type ClubCaller = {
  id: string
  role: 'admin' | 'captain'
  admin: boolean
}

export function serviceClient(): SupabaseClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function oauthSecrets(): { clientId: string; clientSecret: string; supabaseUrl: string } | null {
  const clientId = Deno.env.get('YT_OAUTH_CLIENT_ID')?.trim() ?? ''
  const clientSecret = Deno.env.get('YT_OAUTH_CLIENT_SECRET')?.trim() ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
  if (!clientId || !clientSecret || !supabaseUrl) return null
  return { clientId, clientSecret, supabaseUrl }
}

export async function requireStaff(
  req: Request,
): Promise<{ caller: ClubCaller } | { status: number; error: string }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt || jwt.split('.').length !== 3) {
    return { status: 401, error: 'Sign in again, then open Streams.' }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return { status: 500, error: 'Streams are not available right now.' }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user) return { status: 401, error: 'Sign in again, then open Streams.' }

  const profileResult = await supabase.from('profiles').select('role, access_status').eq('id', user.id).maybeSingle()
  let role = profileResult.data?.role
  let access = profileResult.data?.access_status
  if (profileResult.error && /access_status/i.test(profileResult.error.message)) {
    const retry = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (retry.error) return { status: 500, error: 'Streams are not available right now.' }
    role = retry.data?.role
    access = 'active'
  } else if (profileResult.error) {
    return { status: 500, error: 'Streams are not available right now.' }
  }

  if (access === 'pending') return { status: 403, error: 'Your club access is still pending.' }
  if (role !== 'admin' && role !== 'captain') {
    return { status: 403, error: 'Only a captain or admin can manage YouTube broadcasts.' }
  }
  return { caller: { id: user.id, role, admin: role === 'admin' } }
}
