import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approverIds,
  approverMessage,
  cleanTeamIds,
  decisionMessage,
  defaultTeamId,
  parseSignupChoice,
  parseSignupInput,
  shouldNotifyApprover,
} from './access_request.ts'

const ALPHA = '11111111-1111-4111-8111-111111111111'
const BETA = '22222222-2222-4222-8222-222222222222'

test('signup input keeps a valid request and drops a bad one', () => {
  const parsed = parseSignupInput({
    email: '  Player@Club.Test ',
    full_name: '  Ben   Keys ',
    password: 'long-enough',
    team_ids: [ALPHA, ALPHA.toUpperCase()],
    note: '  I can play Sunday.  ',
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.value.email, 'player@club.test')
  assert.equal(parsed.value.fullName, 'Ben Keys')
  assert.deepEqual(parsed.value.teamIds, [ALPHA])
  assert.equal(parsed.value.note, 'I can play Sunday.')

  assert.equal(parseSignupInput({ email: 'nope', full_name: 'Ben', password: 'long-enough', team_ids: [ALPHA] }).ok, false)
  assert.equal(
    parseSignupInput({ email: 'a@b.co', full_name: 'Ben', password: 'short', team_ids: [ALPHA] }).ok,
    false,
  )
  assert.equal(
    parseSignupInput({ email: 'a@b.co', full_name: 'Ben', password: 'long-enough', team_ids: [] }).ok,
    false,
  )
  assert.equal(
    parseSignupInput({
      email: 'a@b.co',
      full_name: 'Ben',
      password: 'long-enough',
      team_ids: [ALPHA],
      note: 'x'.repeat(501),
    }).ok,
    false,
  )
})

test('a google signup choice needs real side ids and an optional note', () => {
  const parsed = parseSignupChoice({ team_ids: [BETA, ALPHA], note: '', full_name: 'Ada Lovelace' })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.teamIds, [BETA, ALPHA])
  assert.equal(parsed.value.note, null)
  assert.equal(parsed.value.fullName, 'Ada Lovelace')
  assert.equal(parseSignupChoice({ team_ids: ['not-a-team'] }).ok, false)
  assert.equal(parseSignupChoice(null).ok, false)
})

test('team ids reject anything that is not a uuid list', () => {
  assert.equal(cleanTeamIds([ALPHA])?.length, 1)
  assert.equal(cleanTeamIds('nope'), null)
  assert.equal(cleanTeamIds([ALPHA, 12]), null)
})

test('approver mail goes to active admins and captains of the requested sides', () => {
  const staff = [
    { id: 'admin', role: 'admin', active: true, teamIds: [] },
    { id: 'alpha', role: 'captain', active: true, teamIds: [ALPHA] },
    { id: 'beta', role: 'captain', active: true, teamIds: [BETA] },
    { id: 'old', role: 'captain', active: false, teamIds: [ALPHA] },
    { id: 'player', role: 'player', active: true, teamIds: [ALPHA] },
  ]
  assert.deepEqual(approverIds(staff, [ALPHA]), ['admin', 'alpha'])
  assert.equal(shouldNotifyApprover({ role: 'admin', active: true, teamIds: [], requestedTeamIds: [] }), true)
  assert.equal(
    shouldNotifyApprover({ role: 'captain', active: true, teamIds: [BETA], requestedTeamIds: [ALPHA] }),
    false,
  )
})

test('the default side is the requested one the approver can assign', () => {
  assert.equal(defaultTeamId([BETA, ALPHA], [ALPHA]), ALPHA)
  assert.equal(defaultTeamId([BETA], [ALPHA, BETA]), BETA)
  assert.equal(defaultTeamId([], [ALPHA]), ALPHA)
  assert.equal(defaultTeamId([BETA], []), '')
})

test('approver and decision emails escape notes and skip the password', () => {
  const approver = approverMessage({
    requesterName: 'Ben <Keys>',
    requesterEmail: 'ben@club.test',
    teamNames: ['Cheetahs Alpha', 'Cheetahs Beta'],
    note: 'Please <ignore> this',
    reviewUrl: 'https://cheetahs-club.pages.dev/access',
    fromName: 'Cheetahs Cricket Club',
  })
  assert.equal(approver.subject, 'New Cheetahs access request')
  assert.match(approver.text, /Ben <Keys>/)
  assert.match(approver.text, /Cheetahs Alpha and Cheetahs Beta/)
  assert.match(approver.html, /Ben &lt;Keys&gt;/)
  assert.doesNotMatch(approver.html, /Ben <Keys>/)
  assert.equal(approver.text.includes('password'), false)

  const approved = decisionMessage({
    decision: 'approved',
    requesterName: 'Ben',
    teamName: 'Cheetahs Alpha',
    roleName: 'player',
    signInUrl: 'https://cheetahs-club.pages.dev/login',
    fromName: 'Cheetahs Cricket Club',
  })
  assert.match(approved.text, /player with Cheetahs Alpha/)
  assert.match(approved.text, /https:\/\/cheetahs-club\.pages\.dev\/login/)

  const rejected = decisionMessage({
    decision: 'rejected',
    requesterName: 'Ben',
    teamName: null,
    roleName: null,
    signInUrl: 'https://cheetahs-club.pages.dev/login',
    fromName: 'Cheetahs Cricket Club',
  })
  assert.match(rejected.text, /not able to approve/)
  assert.equal(rejected.text.includes('Cheetahs Alpha'), false)
})
