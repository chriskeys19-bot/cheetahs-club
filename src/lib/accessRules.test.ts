import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultTeamId, signupUrl } from './accessRules.ts'

test('the public sign-up link stays on /signup', () => {
  assert.equal(signupUrl('https://cheetahs-club.pages.dev'), 'https://cheetahs-club.pages.dev/signup')
  assert.equal(signupUrl('https://preview.cheetahs-club.pages.dev/'), 'https://preview.cheetahs-club.pages.dev/signup')
})

test('approval defaults to a requested side the captain can assign', () => {
  assert.equal(defaultTeamId(['beta', 'alpha'], ['alpha']), 'alpha')
  assert.equal(defaultTeamId(['beta'], ['alpha', 'beta']), 'beta')
  assert.equal(defaultTeamId([], ['alpha']), 'alpha')
  assert.equal(defaultTeamId(['beta'], []), '')
})
