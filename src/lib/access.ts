import { signupUrl } from './accessRules.ts'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase.ts'
import type { AssignableRole } from './types.ts'

export type AccessQueueRow = {
  id: string
  userId: string
  fullName: string | null
  email: string | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  requestedTeamIds: string[]
  requestedTeamNames: string[]
  assignableTeamIds: string[]
  assignableTeamNames: string[]
  canSetRole: boolean
  decidedAt: string | null
  assignedTeamId: string | null
  assignedRole: AssignableRole | null
}

export type MyAccessRequest = {
  id: string
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  teamNames: string[]
}

const ACCESS_CHANGED = 'cheetahs-access-changed'

export function signupLink(): string {
  if (typeof window === 'undefined') return signupUrl('https://cheetahs-club.pages.dev')
  return signupUrl(window.location.origin)
}

export function notifyAccessChanged(): void {
  window.dispatchEvent(new Event(ACCESS_CHANGED))
}

export function onAccessChanged(listener: () => void): () => void {
  window.addEventListener(ACCESS_CHANGED, listener)
  return () => window.removeEventListener(ACCESS_CHANGED, listener)
}

function accessError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('captains can only approve players')) return 'Captains can approve someone as a player.'
  if (lower.includes('captains can only approve their own sides') || lower.includes('captains can only approve requests')) {
    return 'You can approve a request only for a side you captain.'
  }
  if (lower.includes('captains can only reject')) return 'You can reject a request only when it includes a side you captain.'
  if (lower.includes('request is not pending')) return 'That request was already decided.'
  if (lower.includes('request not found')) return 'That request is no longer in the queue.'
  if (lower.includes('choose a side')) return 'Choose a side.'
  if (lower.includes('invalid role')) return 'Choose player or captain.'
  if (lower.includes('staff role required') || lower.includes('active member required')) {
    return 'Captains and admins decide access requests.'
  }
  if (lower.includes('cannot approve your own') || lower.includes('cannot reject your own')) {
    return 'You cannot decide your own request.'
  }
  return message
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseStatus(value: unknown): AccessQueueRow['status'] | null {
  if (value === 'pending' || value === 'approved' || value === 'rejected') return value
  return null
}

function parseQueueRow(value: unknown): AccessQueueRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const status = parseStatus(row.status)
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string' || !status) return null
  if (typeof row.created_at !== 'string') return null
  const assignedRole = row.assigned_role === 'player' || row.assigned_role === 'captain' ? row.assigned_role : null
  return {
    id: row.id,
    userId: row.user_id,
    fullName: typeof row.full_name === 'string' ? row.full_name : null,
    email: typeof row.email === 'string' ? row.email : null,
    note: typeof row.note === 'string' ? row.note : null,
    status,
    createdAt: row.created_at,
    requestedTeamIds: asStringList(row.requested_team_ids),
    requestedTeamNames: asStringList(row.requested_team_names),
    assignableTeamIds: asStringList(row.assignable_team_ids),
    assignableTeamNames: asStringList(row.assignable_team_names),
    canSetRole: row.can_set_role === true,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : null,
    assignedTeamId: typeof row.assigned_team_id === 'string' ? row.assigned_team_id : null,
    assignedRole,
  }
}

async function postFunction<T>(name: string, body: unknown, accessToken: string | null): Promise<{ data: T | null; error: string | null }> {
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured.' }
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken ?? supabaseAnonKey}`,
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

export async function requestAccess(input: {
  email: string
  fullName: string
  password: string
  teamIds: string[]
  note: string
}): Promise<{ mailed: boolean; error: string | null }> {
  const { data, error } = await postFunction<{ ok?: boolean; mailed?: boolean }>('request-access', {
    email: input.email,
    full_name: input.fullName,
    password: input.password,
    team_ids: input.teamIds,
    note: input.note,
  }, null)
  if (error || !data?.ok) return { mailed: false, error: error ?? 'The request could not be saved.' }
  return { mailed: data.mailed === true, error: null }
}

export async function loadMyAccessRequest(userId: string): Promise<{ request: MyAccessRequest | null; error: string | null }> {
  if (!supabase) return { request: null, error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('access_requests')
    .select('id, note, status, created_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (/access_requests|schema cache/i.test(error.message)) return { request: null, error: null }
    return { request: null, error: error.message }
  }
  if (!data || typeof data !== 'object') return { request: null, error: null }
  const row = data as Record<string, unknown>
  const status = parseStatus(row.status)
  if (typeof row.id !== 'string' || typeof row.created_at !== 'string' || !status) return { request: null, error: null }
  const links = await supabase.from('access_request_teams').select('team_id').eq('request_id', row.id)
  const teamIds = Array.isArray(links.data)
    ? links.data
        .map((item) => (item && typeof item === 'object' ? (item as { team_id?: unknown }).team_id : null))
        .filter((id): id is string => typeof id === 'string')
    : []
  let teamNames: string[] = []
  if (teamIds.length > 0) {
    const teams = await supabase.from('teams').select('id, name, slug').in('id', teamIds)
    if (Array.isArray(teams.data)) {
      teamNames = teams.data
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const team = item as { name?: unknown; slug?: unknown }
          if (typeof team.name !== 'string') return null
          return { name: team.name, slug: typeof team.slug === 'string' ? team.slug : team.name }
        })
        .filter((team): team is { name: string; slug: string } => team !== null)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((team) => team.name)
    }
  }
  return {
    request: {
      id: row.id,
      note: typeof row.note === 'string' ? row.note : null,
      status,
      createdAt: row.created_at,
      teamNames,
    },
    error: null,
  }
}

export async function remindApprovers(): Promise<void> {
  if (!supabase) return
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token ?? null
  await postFunction('notify-access-request', {}, accessToken)
}

export async function loadAccessQueue(): Promise<{ rows: AccessQueueRow[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.rpc('list_access_requests')
  if (error) return { rows: [], error: accessError(error.message) }
  if (!Array.isArray(data)) return { rows: [], error: null }
  return { rows: data.map(parseQueueRow).filter((row): row is AccessQueueRow => row !== null), error: null }
}

export async function pendingAccessCount(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('pending_access_count')
  if (error || typeof data !== 'number' || !Number.isInteger(data) || data < 0) return 0
  return data
}

async function sendDecision(requestId: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) return 'Sign in again, then finish the request.'
  const { data: payload, error } = await postFunction<{ mailed?: boolean }>('send-access-decision', { requestId }, accessToken)
  if (error) return error
  if (payload?.mailed === false) return 'The decision is saved. The email did not send.'
  return null
}

export async function approveAccessRequest(input: {
  requestId: string
  teamId: string
  role: AssignableRole
}): Promise<{ error: string | null; emailNote: string | null }> {
  if (!supabase) return { error: 'Supabase is not configured.', emailNote: null }
  const { error } = await supabase.rpc('approve_access_request', {
    p_request_id: input.requestId,
    p_team_id: input.teamId,
    p_role: input.role,
  })
  if (error) return { error: accessError(error.message), emailNote: null }
  notifyAccessChanged()
  return { error: null, emailNote: await sendDecision(input.requestId) }
}

export async function rejectAccessRequest(requestId: string): Promise<{ error: string | null; emailNote: string | null }> {
  if (!supabase) return { error: 'Supabase is not configured.', emailNote: null }
  const { error } = await supabase.rpc('reject_access_request', { p_request_id: requestId })
  if (error) return { error: accessError(error.message), emailNote: null }
  notifyAccessChanged()
  return { error: null, emailNote: await sendDecision(requestId) }
}
