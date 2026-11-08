import assert from 'node:assert/strict'
import test from 'node:test'
import { isCompletedLeagueListing, isUpcomingLeagueGame } from './scheduleRules.ts'

const game = {
  event_type: 'league_game' as const,
  team_id: 'team-beta',
  match_status: 'scheduled' as const,
  result: null,
  starts_at: '2026-11-01T16:45:00Z',
}

test('upcoming keeps a started game that is not completed', () => {
  const asOf = Date.parse('2026-11-08T20:00:00Z')
  assert.ok(new Date(game.starts_at).getTime() < asOf)
  assert.equal(isCompletedLeagueListing(game, 'beta'), false)
  assert.equal(isUpcomingLeagueGame(game, 'beta'), true)
  assert.equal(isUpcomingLeagueGame({ ...game, starts_at: '2026-11-14T20:45:00Z' }, 'beta'), true)
})

test('upcoming leaves out a completed game', () => {
  assert.equal(isUpcomingLeagueGame({ ...game, match_status: 'completed' }, 'beta'), false)
  assert.equal(isUpcomingLeagueGame({ ...game, result: 'win' }, 'beta'), false)
  assert.equal(isUpcomingLeagueGame({ ...game, result: 'nr' }, 'alpha'), false)
  assert.equal(isUpcomingLeagueGame(game, 'practice'), false)
  assert.equal(isCompletedLeagueListing({ ...game, match_status: 'completed' }, 'beta'), true)
})
