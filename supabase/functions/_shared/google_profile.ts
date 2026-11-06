// Pure helpers for Google sign-in. finish-google-signin and the unit tests
// both use this file. The browser keeps a small copy of the identity check
// in src/lib/googleAuth.ts so the Vite app does not import the functions tree.

export type InviteLookup =
  | { kind: 'none' }
  | { kind: 'unusable'; message: string }
  | { kind: 'mismatch' }
  | { kind: 'match' }

export type GoogleDecision =
  | { action: 'allow' }
  | { action: 'admit' }
  | {
      action: 'reject'
      status: 'invite_required' | 'email_mismatch' | 'invite_unusable' | 'no_profile'
      deleteUser: boolean
      message: string | null
    }

function withoutControls(value: string): string {
  let cleaned = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    cleaned += code >= 32 ? value.charAt(index) : ' '
  }
  return cleaned
}

export function profileNameFromMetadata(metadata: unknown, email: string | null): string {
  const meta = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const fullName = typeof meta.full_name === 'string' ? meta.full_name : ''
  const nameField = typeof meta.name === 'string' ? meta.name : ''
  const preferred = fullName.trim() ? fullName : nameField
  let name = withoutControls(preferred).trim().replace(/\s+/g, ' ')
  if (!name && email) {
    name = email.split('@')[0]?.trim() ?? ''
  }
  if (!name) return 'Player'
  if (name.length > 80) name = name.slice(0, 80).trim()
  return name || 'Player'
}

export function avatarFromMetadata(metadata: unknown): string | null {
  const meta = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const avatar = typeof meta.avatar_url === 'string' ? meta.avatar_url : ''
  const picture = typeof meta.picture === 'string' ? meta.picture : ''
  const value = (avatar.trim() ? avatar : picture).trim()
  if (!value.startsWith('https://') || value.length > 2000 || /\s/.test(value)) return null
  return value
}

export function isGoogleOnlyAccount(input: {
  identities?: { provider: string }[] | null
  providers?: unknown
  provider?: unknown
}): boolean {
  const identities = input.identities ?? []
  if (identities.length > 0) {
    return identities.every((identity) => identity.provider === 'google')
  }
  if (Array.isArray(input.providers) && input.providers.length > 0) {
    return input.providers.every((provider) => provider === 'google')
  }
  return input.provider === 'google'
}

export function hasEmailIdentity(input: {
  identities?: { provider: string }[] | null
  providers?: unknown
}): boolean {
  const identities = input.identities ?? []
  if (identities.some((identity) => identity.provider === 'email')) return true
  return Array.isArray(input.providers) && input.providers.includes('email')
}

export function emailIsVerified(input: {
  emailConfirmedAt: string | null | undefined
  metadata: unknown
}): boolean {
  if (input.emailConfirmedAt) return true
  const meta = input.metadata && typeof input.metadata === 'object' ? (input.metadata as Record<string, unknown>) : {}
  return meta.email_verified === true
}

// A Google-only player is a member only after an invite is accepted, or when
// staff have already promoted them. An email identity means the password
// invite flow created the account. Automatic linking keeps that same user id,
// so the Google sign-in lands on the existing profile.
export function decideGoogleAccess(input: {
  googleOnly: boolean
  hasEmailIdentity: boolean
  emailVerified: boolean
  profileRole: string | null
  acceptedInvite: boolean
  invite: InviteLookup
}): GoogleDecision {
  const hasProfile = input.profileRole !== null
  const staff = input.profileRole === 'admin' || input.profileRole === 'captain'
  const member = hasProfile && (staff || input.hasEmailIdentity || input.acceptedInvite)
  if (member) return { action: 'allow' }

  if (!input.googleOnly) {
    if (hasProfile) return { action: 'allow' }
    return {
      action: 'reject',
      status: 'no_profile',
      deleteUser: false,
      message: 'This account is not on the club roster. Ask an admin to check it.',
    }
  }

  if (input.invite.kind === 'unusable') {
    return {
      action: 'reject',
      status: 'invite_unusable',
      deleteUser: true,
      message: input.invite.message,
    }
  }
  if (input.invite.kind === 'mismatch') {
    return { action: 'reject', status: 'email_mismatch', deleteUser: true, message: null }
  }
  if (input.invite.kind !== 'match' || !input.emailVerified) {
    return {
      action: 'reject',
      status: 'invite_required',
      deleteUser: true,
      message: input.emailVerified ? null : 'Google did not confirm that email address.',
    }
  }
  return { action: 'admit' }
}
