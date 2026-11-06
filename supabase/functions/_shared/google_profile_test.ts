import assert from 'node:assert/strict'
import test from 'node:test'
import {
  avatarFromMetadata,
  decideGoogleAccess,
  emailIsVerified,
  hasEmailIdentity,
  isGoogleOnlyAccount,
  profileNameFromMetadata,
} from './google_profile.ts'

test('profile name prefers Google full_name, then name, then the mailbox', () => {
  assert.equal(profileNameFromMetadata({ full_name: '  Ben   Keys ' }, 'other@club.test'), 'Ben Keys')
  assert.equal(profileNameFromMetadata({ name: 'Ada Lovelace' }, 'ada@club.test'), 'Ada Lovelace')
  assert.equal(profileNameFromMetadata({}, 'captain@club.test'), 'captain')
  assert.equal(profileNameFromMetadata({ full_name: '' }, null), 'Player')
  assert.equal(profileNameFromMetadata({ full_name: 'Line\nBreak' }, null), 'Line Break')
  assert.equal(profileNameFromMetadata({ full_name: 'A'.repeat(90) }, null).length, 80)
})

test('avatar accepts only a compact https URL', () => {
  assert.equal(avatarFromMetadata({ avatar_url: 'https://lh3.googleusercontent.com/a/photo' }), 'https://lh3.googleusercontent.com/a/photo')
  assert.equal(avatarFromMetadata({ picture: 'https://lh3.googleusercontent.com/a/pic' }), 'https://lh3.googleusercontent.com/a/pic')
  assert.equal(avatarFromMetadata({ avatar_url: 'http://example.com/a.png' }), null)
  assert.equal(avatarFromMetadata({ avatar_url: 'https://example.com/a b.png' }), null)
  assert.equal(avatarFromMetadata({}), null)
  assert.equal(avatarFromMetadata(null), null)
})

test('identity helpers treat a linked password account as the same user', () => {
  assert.equal(isGoogleOnlyAccount({ identities: [{ provider: 'google' }] }), true)
  assert.equal(
    isGoogleOnlyAccount({ identities: [{ provider: 'email' }, { provider: 'google' }] }),
    false,
  )
  assert.equal(isGoogleOnlyAccount({ providers: ['google'], provider: 'google' }), true)
  assert.equal(hasEmailIdentity({ identities: [{ provider: 'email' }] }), true)
  assert.equal(hasEmailIdentity({ providers: ['email', 'google'] }), true)
  assert.equal(hasEmailIdentity({ identities: [{ provider: 'google' }] }), false)
  assert.equal(emailIsVerified({ emailConfirmedAt: '2026-11-06T00:00:00Z', metadata: {} }), true)
  assert.equal(emailIsVerified({ emailConfirmedAt: null, metadata: { email_verified: true } }), true)
  assert.equal(emailIsVerified({ emailConfirmedAt: null, metadata: {} }), false)
})

test('an existing password member is allowed through without a new invite', () => {
  const decision = decideGoogleAccess({
    googleOnly: false,
    hasEmailIdentity: true,
    emailVerified: true,
    profileRole: 'player',
    acceptedInvite: true,
    invite: { kind: 'none' },
  })
  assert.deepEqual(decision, { action: 'allow' })
})

test('a Google user with no invite is rejected and removed', () => {
  const decision = decideGoogleAccess({
    googleOnly: true,
    hasEmailIdentity: false,
    emailVerified: true,
    profileRole: 'player',
    acceptedInvite: false,
    invite: { kind: 'none' },
  })
  assert.equal(decision.action, 'reject')
  if (decision.action === 'reject') {
    assert.equal(decision.status, 'invite_required')
    assert.equal(decision.deleteUser, true)
  }
})

test('a matching verified invite admits a new Google player', () => {
  const decision = decideGoogleAccess({
    googleOnly: true,
    hasEmailIdentity: false,
    emailVerified: true,
    profileRole: 'player',
    acceptedInvite: false,
    invite: { kind: 'match' },
  })
  assert.deepEqual(decision, { action: 'admit' })
})

test('a Google account for a different email does not consume the invite', () => {
  const decision = decideGoogleAccess({
    googleOnly: true,
    hasEmailIdentity: false,
    emailVerified: true,
    profileRole: null,
    acceptedInvite: false,
    invite: { kind: 'mismatch' },
  })
  assert.equal(decision.action, 'reject')
  if (decision.action === 'reject') {
    assert.equal(decision.status, 'email_mismatch')
    assert.equal(decision.deleteUser, true)
  }
})

test('staff and an already accepted Google player stay members', () => {
  assert.equal(
    decideGoogleAccess({
      googleOnly: true,
      hasEmailIdentity: false,
      emailVerified: true,
      profileRole: 'captain',
      acceptedInvite: false,
      invite: { kind: 'none' },
    }).action,
    'allow',
  )
  assert.equal(
    decideGoogleAccess({
      googleOnly: true,
      hasEmailIdentity: false,
      emailVerified: true,
      profileRole: 'player',
      acceptedInvite: true,
      invite: { kind: 'none' },
    }).action,
    'allow',
  )
})
