import {
  avatarFromMetadata,
  decideGoogleAccess,
  emailIsVerified,
  hasEmailIdentity,
  isGoogleOnlyAccount,
  profileNameFromMetadata,
  type InviteLookup,
} from '../_shared/google_profile.ts'
import { parseSignupChoice, type SignupChoice } from '../_shared/access_request.ts'
import { notifyApprovers } from '../_shared/access_notify.ts'
import { adminClient, json, loadInvite, readBody, tokenFrom, type InviteRow } from '../_shared/invite.ts'
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2.81.1'

type ProfileRow = {
  id: string
  role: string
  full_name: string | null
  avatar_url: string | null
  access_status: 'active' | 'pending' | null
}

function bearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim() ?? ''
  if (!token || token.split('.').length < 3) return null
  return token
}

function isProfile(value: unknown): value is ProfileRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.role === 'string' &&
    (row.full_name === null || typeof row.full_name === 'string') &&
    (row.avatar_url === null || typeof row.avatar_url === 'string') &&
    (row.access_status === undefined || row.access_status === null || row.access_status === 'active' || row.access_status === 'pending')
  )
}

async function messageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
  } catch {
    return 'This join link is not valid.'
  }
  return 'This join link is not valid.'
}

async function lookupInvite(
  req: Request,
  admin: SupabaseClient,
  token: string | null,
  email: string | null,
): Promise<InviteLookup & { invite?: InviteRow }> {
  if (token) {
    const loaded = await loadInvite(req, admin, token)
    if ('error' in loaded) {
      return { kind: 'unusable', message: await messageFrom(loaded.error) }
    }
    if (!email || loaded.invite.email.toLowerCase() !== email.toLowerCase()) {
      return { kind: 'mismatch' }
    }
    return { kind: 'match', invite: loaded.invite }
  }

  if (!email) return { kind: 'none' }
  const { data, error } = await admin
    .from('invites')
    .select('id, email, status, expires_at, team_id, role_intended')
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    console.error('google invite lookup failed', error.code)
    return { kind: 'unusable', message: 'The invite could not be checked. Try again.' }
  }
  if (!data || typeof data !== 'object') return { kind: 'none' }
  const row = data as InviteRow
  if (typeof row.id !== 'string' || typeof row.email !== 'string') return { kind: 'none' }
  if (row.email.toLowerCase() !== email.toLowerCase()) return { kind: 'mismatch' }
  return { kind: 'match', invite: row }
}

async function hasAcceptedInvite(admin: SupabaseClient, userId: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from('invites')
    .select('id')
    .eq('accepted_user_id', userId)
    .eq('status', 'accepted')
    .limit(1)
  if (error) {
    console.error('accepted invite lookup failed', error.code)
    return null
  }
  return Array.isArray(data) && data.length > 0
}

async function attachInvite(admin: SupabaseClient, userId: string, invite: InviteRow): Promise<boolean> {
  const accepted = await admin
    .from('invites')
    .update({
      status: 'accepted',
      accepted_user_id: userId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (accepted.error || !accepted.data) {
    const again = await admin
      .from('invites')
      .select('status, accepted_user_id')
      .eq('id', invite.id)
      .maybeSingle()
    const row = again.data as { status?: string; accepted_user_id?: string | null } | null
    if (!row || row.status !== 'accepted' || row.accepted_user_id !== userId) {
      console.error('google invite accept failed', invite.id)
      return false
    }
  }

  if (invite.team_id) {
    const membership = await admin.from('team_members').insert({
      team_id: invite.team_id,
      profile_id: userId,
    })
    if (membership.error && membership.error.code !== '23505') {
      console.error('google team assign failed', invite.id)
    }
  }
  return true
}

async function admitPlayer(admin: SupabaseClient, user: User, invite: InviteRow): Promise<boolean> {
  const payload = {
    id: user.id,
    full_name: profileNameFromMetadata(user.user_metadata, user.email ?? null),
    avatar_url: avatarFromMetadata(user.user_metadata),
    role: 'player',
    access_status: 'active',
  }
  let saved = await admin.from('profiles').upsert(payload, { onConflict: 'id' })
  if (saved.error && /access_status/i.test(saved.error.message)) {
    const { access_status: _access, ...legacy } = payload
    saved = await admin.from('profiles').upsert(legacy, { onConflict: 'id' })
  }
  if (saved.error) {
    console.error('google profile was not saved', saved.error.code)
    return false
  }
  if (invite.team_id) {
    const closed = await admin
      .from('access_requests')
      .update({
        status: 'approved',
        decided_at: new Date().toISOString(),
        assigned_team_id: invite.team_id,
        assigned_role: 'player',
      })
      .eq('user_id', user.id)
      .eq('status', 'pending')
    if (closed.error && !/access_requests|schema cache/i.test(closed.error.message)) {
      console.error('pending request was not closed', closed.error.code)
    }
  } else {
    const removed = await admin.from('access_requests').delete().eq('user_id', user.id).eq('status', 'pending')
    if (removed.error && !/access_requests|schema cache/i.test(removed.error.message)) {
      console.error('pending request was not cleared', removed.error.code)
    }
  }
  return attachInvite(admin, user.id, invite)
}

async function fillEmptyProfile(admin: SupabaseClient, user: User, profile: ProfileRow): Promise<void> {
  const patch: { full_name?: string; avatar_url?: string } = {}
  if (!profile.full_name?.trim()) {
    patch.full_name = profileNameFromMetadata(user.user_metadata, user.email ?? null)
  }
  const avatar = avatarFromMetadata(user.user_metadata)
  if (avatar && !profile.avatar_url) patch.avatar_url = avatar
  if (!patch.full_name && !patch.avatar_url) return
  const { error } = await admin.from('profiles').update(patch).eq('id', user.id)
  if (error) console.error('google profile backfill failed', error.code)
}

Deno.serve(async (req: Request) => {
  const body = await readBody(req)
  if (body instanceof Response) return body

  const rawToken = body && typeof body === 'object' ? (body as Record<string, unknown>).token : undefined
  const token = tokenFrom(body)
  const tokenError = typeof rawToken === 'string' && rawToken.trim() && !token ? 'This join link is not valid.' : null

  const admin = adminClient()
  if (!admin) return json(req, 500, { status: 'error', message: 'Google sign-in is not configured.' })

  const jwt = bearer(req)
  if (!jwt) return json(req, 401, { status: 'error', message: 'Sign in again.' })
  const authed = await admin.auth.getUser(jwt)
  const user = authed.data.user
  if (authed.error || !user) return json(req, 401, { status: 'error', message: 'Sign in again.' })

  const profileResult = await admin
    .from('profiles')
    .select('id, role, full_name, avatar_url, access_status')
    .eq('id', user.id)
    .maybeSingle()
  let profileData: unknown = profileResult.data
  if (profileResult.error && /access_status/i.test(profileResult.error.message)) {
    const legacy = await admin.from('profiles').select('id, role, full_name, avatar_url').eq('id', user.id).maybeSingle()
    if (legacy.error) {
      console.error('google profile read failed', legacy.error.code)
      return json(req, 500, { status: 'error', message: 'Google sign-in could not be checked. Try again.' })
    }
    profileData = legacy.data
  } else if (profileResult.error) {
    console.error('google profile read failed', profileResult.error.code)
    return json(req, 500, { status: 'error', message: 'Google sign-in could not be checked. Try again.' })
  }
  const profile = isProfile(profileData) ? profileData : null
  const acceptedInvite = profile ? await hasAcceptedInvite(admin, user.id) : false
  if (acceptedInvite === null) {
    return json(req, 500, { status: 'error', message: 'Google sign-in could not be checked. Try again.' })
  }

  const signupRaw = body && typeof body === 'object' ? (body as Record<string, unknown>).signup : undefined
  let signup: SignupChoice | null = null
  if (signupRaw != null) {
    const parsed = parseSignupChoice(signupRaw)
    if (parsed.ok) signup = parsed.value
  }
  const pendingLookup = await admin
    .from('access_requests')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .limit(1)
  if (pendingLookup.error && !/access_requests|schema cache/i.test(pendingLookup.error.message)) {
    console.error('access request lookup failed', pendingLookup.error.code)
    return json(req, 500, { status: 'error', message: 'Google sign-in could not be checked. Try again.' })
  }
  const hasPendingRequest = !pendingLookup.error && Array.isArray(pendingLookup.data) && pendingLookup.data.length > 0

  const invite = tokenError
    ? { kind: 'unusable' as const, message: tokenError }
    : await lookupInvite(req, admin, token, user.email ?? null)
  const identityInput = {
    identities: user.identities ?? null,
    providers: user.app_metadata?.providers,
    provider: user.app_metadata?.provider,
  }
  const accessStatus = profile?.access_status === 'active' || profile?.access_status === 'pending' ? profile.access_status : null
  const decision = decideGoogleAccess({
    googleOnly: isGoogleOnlyAccount(identityInput),
    hasEmailIdentity: hasEmailIdentity(identityInput),
    emailVerified: emailIsVerified({
      emailConfirmedAt: user.email_confirmed_at,
      metadata: user.user_metadata,
    }),
    profileRole: profile?.role ?? null,
    acceptedInvite,
    invite,
    accessStatus,
    hasPendingRequest,
    signupRequested: signup !== null,
  })

  if (decision.action === 'allow' || decision.action === 'hold') {
    if (profile && decision.action === 'allow') await fillEmptyProfile(admin, user, profile)
    if (decision.action === 'allow' && invite.kind === 'match' && invite.invite) {
      const attached = await attachInvite(admin, user.id, invite.invite)
      if (!attached) console.error('existing member invite attach failed', invite.invite.id)
    }
    return json(req, 200, { status: decision.action === 'hold' ? 'pending' : 'member' })
  }

  if (decision.action === 'request') {
    if (!signup) {
      const removed = await admin.auth.admin.deleteUser(user.id)
      if (removed.error) console.error('google user delete failed', removed.error.message)
      return json(req, 200, { status: 'invite_unusable', message: 'Choose at least one side, then try again.' })
    }
    if (signup.fullName) {
      const named = await admin.from('profiles').update({ full_name: signup.fullName }).eq('id', user.id)
      if (named.error) console.error('signup name was not saved', named.error.code)
    }
    const recorded = await admin.rpc('create_access_request', {
      p_user_id: user.id,
      p_note: signup.note,
      p_team_ids: signup.teamIds,
    })
    const row = Array.isArray(recorded.data) ? recorded.data[0] : recorded.data
    const requestId = row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : null
    const createdFlag = row && typeof row === 'object' && (row as { created?: unknown }).created === true
    if (recorded.error || !requestId) {
      console.error('google access request was not saved', recorded.error?.code ?? 'empty')
      const removed = await admin.auth.admin.deleteUser(user.id)
      if (removed.error) console.error('google user delete failed', removed.error.message)
      return json(req, 200, {
        status: 'invite_unusable',
        message: 'The request could not be saved. Try again in a moment.',
      })
    }
    if (createdFlag) await notifyApprovers(admin, requestId)
    return json(req, 200, { status: 'pending' })
  }

  if (decision.action === 'reject') {
    if (decision.deleteUser) {
      const removed = await admin.auth.admin.deleteUser(user.id)
      if (removed.error) console.error('google user delete failed', removed.error.message)
    }
    return json(req, 200, {
      status: decision.status,
      message: decision.message,
    })
  }

  if (invite.kind !== 'match' || !invite.invite) {
    return json(req, 500, { status: 'error', message: 'Google sign-in could not be checked. Try again.' })
  }
  const admitted = await admitPlayer(admin, user, invite.invite)
  if (!admitted) {
    const removed = await admin.auth.admin.deleteUser(user.id)
    if (removed.error) console.error('google rollback delete failed', removed.error.message)
    return json(req, 200, {
      status: 'invite_unusable',
      message: 'The account could not be created. Try again in a moment.',
    })
  }
  return json(req, 200, { status: 'joined' })
})
