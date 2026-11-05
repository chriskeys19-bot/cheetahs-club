import { actionError } from './errors.ts'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase.ts'
import { isInviteStatus, type ClubInvite, type Team } from './types.ts'

export type InvitePreview = {
  email: string
  teamName: string | null
  expiresAt: string
}

function inviteError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('already has a club account') || lower.includes('already registered')) {
    return 'That email already has a club account. Add them to a side below instead of sending a new join link.'
  }
  if (lower.includes('invites_pending_email') || (lower.includes('duplicate') && lower.includes('invite'))) {
    return 'An invite is already waiting for that email. Revoke it before sending another.'
  }
  if (lower.includes('invalid email')) return 'Enter a valid email address.'
  if (lower.includes('teams') || lower.includes('team_id')) return 'Choose Alpha, Beta, Gamma, or no side.'
  return actionError(message)
}

function parseInvite(value: unknown): ClubInvite | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.email !== 'string' || typeof row.token !== 'string') return null
  if (!isInviteStatus(row.status)) return null
  if (typeof row.expires_at !== 'string' || typeof row.created_at !== 'string') return null
  if (row.team_id !== null && typeof row.team_id !== 'string') return null
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    team_id: row.team_id,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }
}

const INVITE_COLUMNS = 'id, email, token, team_id, status, expires_at, created_at'

export async function loadPendingInvites(): Promise<{ rows: ClubInvite[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('invites')
    .select(INVITE_COLUMNS)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) return { rows: [], error: inviteError(error.message) }
  if (!Array.isArray(data)) return { rows: [], error: null }
  return { rows: data.map(parseInvite).filter((row): row is ClubInvite => row !== null), error: null }
}

export async function createInvite(input: {
  email: string
  teamId: string | null
}): Promise<{ invite: ClubInvite | null; error: string | null; existingAccount: boolean }> {
  if (!supabase) return { invite: null, error: 'Supabase is not configured.', existingAccount: false }
  const email = input.email.trim().toLowerCase()
  const { data, error } = await supabase
    .from('invites')
    .insert({ email, team_id: input.teamId })
    .select(INVITE_COLUMNS)
    .single()
  if (error) {
    const existingAccount = /already has a club account|already registered/i.test(error.message)
    return { invite: null, error: inviteError(error.message), existingAccount }
  }
  const invite = parseInvite(data)
  if (!invite) {
    return { invite: null, error: 'The invite was saved but could not be read back.', existingAccount: false }
  }
  return { invite, error: null, existingAccount: false }
}

export async function revokeInvite(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase
    .from('invites')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) return inviteError(error.message)
  if (!Array.isArray(data) || data.length === 0) return 'That invite is no longer pending.'
  return null
}

async function postFunction<T>(name: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured.' }
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return { data: null, error: 'The club could not be reached. Try again.' }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'The request failed.'
    return { data: null, error: message }
  }
  return { data: payload as T, error: null }
}

export async function previewInvite(token: string): Promise<{ preview: InvitePreview | null; error: string | null }> {
  const { data, error } = await postFunction<Record<string, unknown>>('preview-invite', { token })
  if (error || !data) return { preview: null, error: error ?? 'This join link is not valid.' }
  if (typeof data.email !== 'string' || typeof data.expiresAt !== 'string') {
    return { preview: null, error: 'This join link is not valid.' }
  }
  const teamName = typeof data.teamName === 'string' ? data.teamName : null
  return { preview: { email: data.email, teamName, expiresAt: data.expiresAt }, error: null }
}

export async function acceptInvite(input: {
  token: string
  fullName: string
  password: string
}): Promise<string | null> {
  const { error } = await postFunction<{ ok: boolean }>('accept-invite', {
    token: input.token,
    full_name: input.fullName,
    password: input.password,
  })
  return error
}

export function teamName(teams: Team[], teamId: string | null): string {
  if (!teamId) return 'No side yet'
  return teams.find((team) => team.id === teamId)?.name ?? 'Side'
}
