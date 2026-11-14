import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import {
  approverIds,
  approverMessage,
  decisionMessage,
  type ClubMessage,
} from './access_request.ts'
import { appOrigin, sendClubMessages, smtpSettings } from './access_mail.ts'

type RequestRow = {
  id: string
  user_id: string
  note: string | null
  status: string
  notified_at: string | null
  requester_notified_at: string | null
  decided_by: string | null
  assigned_role: string | null
  assigned_team_id: string | null
}

function isRequest(value: unknown): value is RequestRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && typeof row.user_id === 'string' && typeof row.status === 'string'
}

async function userEmail(admin: SupabaseClient, userId: string): Promise<{ email: string; name: string | null } | null> {
  const result = await admin.auth.admin.getUserById(userId)
  const email = result.data.user?.email?.trim().toLowerCase() ?? ''
  if (!email) return null
  const meta = result.data.user?.user_metadata
  const name = meta && typeof meta === 'object' && typeof (meta as { full_name?: unknown }).full_name === 'string'
    ? (meta as { full_name: string }).full_name
    : null
  return { email, name }
}

async function teamNames(admin: SupabaseClient, requestId: string): Promise<{ ids: string[]; names: string[] }> {
  const links = await admin.from('access_request_teams').select('team_id').eq('request_id', requestId)
  const ids = Array.isArray(links.data)
    ? links.data
        .map((row) => (row && typeof row === 'object' ? (row as { team_id?: unknown }).team_id : null))
        .filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length === 0) return { ids: [], names: [] }
  const teams = await admin.from('teams').select('id, name, slug').in('id', ids)
  const rows = Array.isArray(teams.data) ? teams.data : []
  const ordered = rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const item = row as { id?: unknown; name?: unknown; slug?: unknown }
      if (typeof item.id !== 'string' || typeof item.name !== 'string') return null
      return { id: item.id, name: item.name, slug: typeof item.slug === 'string' ? item.slug : item.name }
    })
    .filter((row): row is { id: string; name: string; slug: string } => row !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug))
  return { ids: ordered.map((row) => row.id), names: ordered.map((row) => row.name) }
}

async function approverRecipients(
  admin: SupabaseClient,
  requestedTeamIds: string[],
): Promise<{ email: string; messageName: string }[]> {
  const profiles = await admin.from('profiles').select('id, role, access_status, full_name').in('role', ['admin', 'captain'])
  const memberships = requestedTeamIds.length
    ? await admin.from('team_members').select('profile_id, team_id').in('team_id', requestedTeamIds)
    : { data: [] }
  const teamsByPerson = new Map<string, string[]>()
  if (Array.isArray(memberships.data)) {
    for (const row of memberships.data) {
      if (!row || typeof row !== 'object') continue
      const item = row as { profile_id?: unknown; team_id?: unknown }
      if (typeof item.profile_id !== 'string' || typeof item.team_id !== 'string') continue
      const list = teamsByPerson.get(item.profile_id) ?? []
      list.push(item.team_id)
      teamsByPerson.set(item.profile_id, list)
    }
  }
  const staff = Array.isArray(profiles.data)
    ? profiles.data.flatMap((row) => {
        if (!row || typeof row !== 'object') return []
        const item = row as { id?: unknown; role?: unknown; access_status?: unknown; full_name?: unknown }
        if (typeof item.id !== 'string' || typeof item.role !== 'string') return []
        return [
          {
            id: item.id,
            role: item.role,
            active: item.access_status === 'active' || item.access_status == null,
            teamIds: teamsByPerson.get(item.id) ?? [],
            name: typeof item.full_name === 'string' ? item.full_name : null,
          },
        ]
      })
    : []
  // access_status == null keeps mail working if this function is deployed
  // before the column exists. After the migration, only active staff match.
  const ids = approverIds(
    staff.map((person) => ({ id: person.id, role: person.role, active: person.active, teamIds: person.teamIds })),
    requestedTeamIds,
  )
  const recipients: { email: string; messageName: string }[] = []
  for (const id of ids) {
    const user = await userEmail(admin, id)
    if (!user) continue
    recipients.push({ email: user.email, messageName: user.name ?? user.email })
  }
  return recipients
}

async function sendAll(messages: { to: string; message: ClubMessage }[]): Promise<boolean> {
  if (messages.length === 0) return false
  const settings = smtpSettings()
  if (!settings) return false
  const result = await sendClubMessages(settings, messages)
  return result.sent > 0
}

export async function notifyApprovers(admin: SupabaseClient, requestId: string): Promise<{ mailed: boolean }> {
  const loaded = await admin
    .from('access_requests')
    .select('id, user_id, note, status, notified_at, requester_notified_at, decided_by, assigned_role, assigned_team_id')
    .eq('id', requestId)
    .maybeSingle()
  if (loaded.error || !isRequest(loaded.data) || loaded.data.status !== 'pending') return { mailed: false }
  if (loaded.data.notified_at) return { mailed: true }

  const claim = await admin
    .from('access_requests')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', requestId)
    .is('notified_at', null)
    .select('id')
  if (claim.error || !Array.isArray(claim.data) || claim.data.length === 0) return { mailed: true }

  const release = async () => {
    await admin.from('access_requests').update({ notified_at: null }).eq('id', requestId)
  }

  try {
    const sides = await teamNames(admin, requestId)
    const recipients = await approverRecipients(admin, sides.ids)
    const requester = await userEmail(admin, loaded.data.user_id)
    if (!requester || recipients.length === 0) {
      // Nobody to mail. Leave the claim so a reload does not retry forever.
      // The in-app queue is the notice.
      return { mailed: false }
    }
    const profile = await admin.from('profiles').select('full_name').eq('id', loaded.data.user_id).maybeSingle()
    const profileName =
      profile.data && typeof profile.data === 'object' && typeof (profile.data as { full_name?: unknown }).full_name === 'string'
        ? (profile.data as { full_name: string }).full_name
        : null
    const message = approverMessage({
      requesterName: profileName || requester.name || requester.email,
      requesterEmail: requester.email,
      teamNames: sides.names,
      note: loaded.data.note,
      reviewUrl: `${appOrigin()}/access`,
      fromName: smtpSettings()?.fromName ?? 'Cheetahs Cricket Club',
    })
    const mailed = await sendAll(recipients.map((person) => ({ to: person.email, message })))
    if (!mailed) await release()
    return { mailed }
  } catch (error) {
    console.error('approver notify failed', error instanceof Error ? error.message.slice(0, 200) : 'failed')
    await release()
    return { mailed: false }
  }
}

export async function notifyRequester(
  admin: SupabaseClient,
  requestId: string,
  actorId: string,
): Promise<{ mailed: boolean; missing: boolean }> {
  const loaded = await admin
    .from('access_requests')
    .select('id, user_id, note, status, notified_at, requester_notified_at, decided_by, assigned_role, assigned_team_id')
    .eq('id', requestId)
    .maybeSingle()
  if (loaded.error || !isRequest(loaded.data)) return { mailed: false, missing: true }
  const request = loaded.data
  if (request.decided_by !== actorId) return { mailed: false, missing: true }
  if (request.status !== 'approved' && request.status !== 'rejected') return { mailed: false, missing: false }
  if (request.requester_notified_at) return { mailed: true, missing: false }

  const claim = await admin
    .from('access_requests')
    .update({ requester_notified_at: new Date().toISOString() })
    .eq('id', requestId)
    .is('requester_notified_at', null)
    .select('id')
  if (claim.error || !Array.isArray(claim.data) || claim.data.length === 0) return { mailed: true, missing: false }

  const release = async () => {
    await admin.from('access_requests').update({ requester_notified_at: null }).eq('id', requestId)
  }

  try {
    const requester = await userEmail(admin, request.user_id)
    if (!requester) return { mailed: false, missing: false }
    const profile = await admin.from('profiles').select('full_name').eq('id', request.user_id).maybeSingle()
    const profileName =
      profile.data && typeof profile.data === 'object' && typeof (profile.data as { full_name?: unknown }).full_name === 'string'
        ? (profile.data as { full_name: string }).full_name
        : requester.name
    let teamName: string | null = null
    if (request.assigned_team_id) {
      const team = await admin.from('teams').select('name').eq('id', request.assigned_team_id).maybeSingle()
      if (team.data && typeof team.data === 'object' && typeof (team.data as { name?: unknown }).name === 'string') {
        teamName = (team.data as { name: string }).name
      }
    }
    const roleName = request.assigned_role === 'captain' ? 'captain' : request.assigned_role === 'player' ? 'player' : null
    const message = decisionMessage({
      decision: request.status,
      requesterName: profileName || requester.email,
      teamName,
      roleName,
      signInUrl: `${appOrigin()}/login`,
      fromName: smtpSettings()?.fromName ?? 'Cheetahs Cricket Club',
    })
    const mailed = await sendAll([{ to: requester.email, message }])
    if (!mailed) await release()
    return { mailed, missing: false }
  } catch (error) {
    console.error('requester notify failed', error instanceof Error ? error.message.slice(0, 200) : 'failed')
    await release()
    return { mailed: false, missing: false }
  }
}
