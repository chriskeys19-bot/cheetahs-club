import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTeamRecords, recordSummary, recordsForSide, type RecordEvent, type RecordTeam } from './teamRecord.ts'

const teams: RecordTeam[] = [
  { id: 'alpha', name: 'Cheetahs Alpha', slug: 'alpha' },
  { id: 'beta', name: 'Cheetahs Beta', slug: 'beta' },
  { id: 'gamma', name: 'Cheetahs Gamma', slug: 'gamma' },
]

function game(patch: Partial<RecordEvent> & Pick<RecordEvent, 'id' | 'team_id'>): RecordEvent {
  return {
    event_type: 'league_game',
    result: null,
    match_status: 'scheduled',
    game_date: '2026-11-15',
    start_time: '09:00:00',
    opponent: 'Somebody',
    ...patch,
  }
}

test('counts league wins, losses, and games still to play', () => {
  const events: RecordEvent[] = [
    game({
      id: 'a-loss',
      team_id: 'alpha',
      game_date: '2026-11-01',
      opponent: 'Cougars Black',
      result: 'loss',
      match_status: 'completed',
    }),
    game({
      id: 'a-win',
      team_id: 'alpha',
      game_date: '2026-11-08',
      opponent: 'Tracy Centurions',
      result: 'win',
      match_status: 'completed',
    }),
    game({ id: 'a-left-1', team_id: 'alpha', match_status: 'scheduled' }),
    game({ id: 'a-left-2', team_id: 'alpha', match_status: 'in_progress' }),
    game({
      id: 'practice',
      team_id: 'alpha',
      event_type: 'practice',
      result: 'win',
      match_status: 'completed',
    }),
    game({
      id: 'umpiring',
      team_id: 'alpha',
      event_type: 'umpiring',
      result: 'loss',
      match_status: 'completed',
    }),
    game({ id: 'no-side', team_id: null, result: 'win', match_status: 'completed' }),
    game({
      id: 'b-win',
      team_id: 'beta',
      game_date: '2026-11-01',
      start_time: '18:00:00',
      opponent: 'Livermore Monks',
      result: 'win',
      match_status: 'completed',
    }),
  ]

  const records = buildTeamRecords(teams, events)
  const alpha = records[0]
  const beta = records[1]
  const gamma = records[2]
  assert.ok(alpha && beta && gamma)

  assert.equal(alpha.shortName, 'Alpha')
  assert.equal(alpha.wins, 1)
  assert.equal(alpha.losses, 1)
  assert.equal(alpha.tiesOrNr, 0)
  assert.equal(alpha.toPlay, 2)
  assert.equal(recordSummary(alpha), '1 W · 1 L · 2 to play')
  assert.deepEqual(
    alpha.form.map((mark) => mark.label),
    ['L vs Cougars Black, Nov 1', 'W vs Tracy Centurions, Nov 8'],
  )
  assert.deepEqual(
    alpha.form.map((mark) => mark.letter),
    ['L', 'W'],
  )

  assert.equal(recordSummary(beta), '1 W · 0 L · 0 to play')
  assert.equal(beta.form[0]?.label, 'W vs Livermore Monks, Nov 1')
  assert.equal(recordSummary(gamma), '0 W · 0 L · 0 to play')
  assert.deepEqual(gamma.form, [])
})

test('groups draws and no-results, and ignores a completed game with no result', () => {
  const events: RecordEvent[] = [
    game({
      id: 'draw',
      team_id: 'gamma',
      game_date: '2026-10-18',
      opponent: 'Bay Blazers',
      result: 'draw',
      match_status: 'completed',
    }),
    game({
      id: 'nr',
      team_id: 'gamma',
      game_date: '2026-10-25',
      opponent: 'Valley Kings',
      result: 'nr',
      match_status: 'scheduled',
    }),
    game({
      id: 'posted-early',
      team_id: 'gamma',
      game_date: '2026-11-01',
      opponent: 'All Stars United',
      result: 'loss',
      match_status: 'scheduled',
    }),
    game({
      id: 'blank-final',
      team_id: 'gamma',
      game_date: '2026-11-02',
      opponent: 'Missing Card',
      result: null,
      match_status: 'completed',
    }),
  ]

  const gamma = buildTeamRecords(teams, events).find((record) => record.slug === 'gamma')
  assert.ok(gamma)
  assert.equal(gamma.wins, 0)
  assert.equal(gamma.losses, 1)
  assert.equal(gamma.tiesOrNr, 2)
  assert.equal(gamma.toPlay, 0)
  assert.equal(recordSummary(gamma), '0 W · 1 L · 2 T/NR · 0 to play')
  assert.deepEqual(
    gamma.form.map((mark) => [mark.letter, mark.result, mark.label]),
    [
      ['T', 'draw', 'T vs Bay Blazers, Oct 18'],
      ['NR', 'nr', 'NR vs Valley Kings, Oct 25'],
      ['L', 'loss', 'L vs All Stars United, Nov 1'],
    ],
  )
})

test('form is the last five completed results, oldest to newest', () => {
  const results = ['loss', 'win', 'draw', 'nr', 'win', 'loss'] as const
  const events = results.map((result, index) =>
    game({
      id: `g-${index}`,
      team_id: 'beta',
      game_date: `2026-10-${String(index + 10).padStart(2, '0')}`,
      start_time: index % 2 === 0 ? '18:00:00' : '09:00:00',
      opponent: `Side ${index + 1}`,
      result,
      match_status: 'completed',
    }),
  )
  events.push(
    game({
      id: 'same-day-early',
      team_id: 'beta',
      game_date: '2026-10-15',
      start_time: '08:00:00',
      opponent: 'Early Side',
      result: 'win',
      match_status: 'completed',
    }),
  )

  const beta = buildTeamRecords(teams, events).find((record) => record.slug === 'beta')
  assert.ok(beta)
  assert.equal(beta.wins, 3)
  assert.equal(beta.losses, 2)
  assert.equal(beta.tiesOrNr, 2)
  assert.equal(beta.form.length, 5)
  assert.deepEqual(
    beta.form.map((mark) => mark.label),
    [
      'T vs Side 3, Oct 12',
      'NR vs Side 4, Oct 13',
      'W vs Side 5, Oct 14',
      'W vs Early Side, Oct 15',
      'L vs Side 6, Oct 15',
    ],
  )
})

test('a team filter keeps one row and other filters keep every side', () => {
  const records = buildTeamRecords(teams, [
    game({ id: 'a', team_id: 'alpha', result: 'win', match_status: 'completed' }),
    game({ id: 'b', team_id: 'beta', result: 'loss', match_status: 'completed' }),
  ])
  assert.deepEqual(
    recordsForSide(records, 'alpha', []).map((record) => record.slug),
    ['alpha'],
  )
  assert.deepEqual(
    recordsForSide(records, 'mine', ['beta', 'gamma']).map((record) => record.slug),
    ['beta', 'gamma'],
  )
  assert.equal(recordsForSide(records, 'mine', []).length, 0)
  assert.deepEqual(
    recordsForSide(records, 'upcoming', []).map((record) => record.slug),
    ['alpha', 'beta', 'gamma'],
  )
  assert.deepEqual(
    recordsForSide(records, 'practice', []).map((record) => record.slug),
    ['alpha', 'beta', 'gamma'],
  )
})
