import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCalendarItems,
  dayButtonLabel,
  dotsForDay,
  formatDayHeading,
  formatMonthTitle,
  groupCalendarItems,
  monthGrid,
  shiftMonth,
} from './calendar.ts'
import type { Activity, DuesAssessment, Expense, Poll, ScheduleEvent, Team } from './types.ts'

const teams: Team[] = [
  { id: 'alpha-id', name: 'Cheetahs Alpha', slug: 'alpha' },
  { id: 'beta-id', name: 'Cheetahs Beta', slug: 'beta' },
  { id: 'gamma-id', name: 'Cheetahs Gamma', slug: 'gamma' },
  { id: 'visitor-id', name: 'Visitors', slug: 'visitors' },
]

const asOf = Date.parse('2026-11-07T01:05:00.000Z')

function event(
  partial: Pick<ScheduleEvent, 'id' | 'event_type' | 'game_date' | 'start_time' | 'opponent'> &
    Partial<ScheduleEvent>,
): ScheduleEvent {
  return {
    team_id: null,
    umpiring_team_id: null,
    end_time: null,
    starts_at: '2026-11-08T16:45:00.000Z',
    ends_at: null,
    match_format: null,
    ground: 'Birch Grove',
    address: null,
    division: null,
    notes: null,
    created_by: null,
    series_id: null,
    venue_side: null,
    ball_color: null,
    dress_code: null,
    result: null,
    scorecard_url: null,
    video_url: null,
    match_status: 'scheduled',
    ...partial,
  }
}

function activity(partial: Pick<Activity, 'id' | 'starts_at'> & Partial<Activity>): Activity {
  return {
    title: 'Nets',
    description: null,
    ends_at: null,
    location: null,
    team_id: null,
    created_by: null,
    created_at: '2026-11-01T00:00:00.000Z',
    series_id: null,
    ...partial,
  }
}

test('November 2026 is a Monday-start grid with faded neighbor days', () => {
  const cells = monthGrid(2026, 11)
  assert.equal(cells.length, 42)
  assert.deepEqual(cells[0], { date: '2026-10-26', day: 26, inMonth: false })
  assert.deepEqual(cells[6], { date: '2026-11-01', day: 1, inMonth: true })
  assert.deepEqual(cells[35], { date: '2026-11-30', day: 30, inMonth: true })
  assert.deepEqual(cells[41], { date: '2026-12-06', day: 6, inMonth: false })
  assert.equal(formatMonthTitle(2026, 11), 'November 2026')
  assert.equal(formatDayHeading('2026-11-06'), 'Friday, November 6')
  assert.equal(dayButtonLabel('2026-11-06', 0, true), 'Friday, November 6, 2026, today, nothing scheduled')
  assert.equal(dayButtonLabel('2026-11-08', 2, false), 'Sunday, November 8, 2026, 2 items')
})

test('month navigation crosses the year and rejects a bad month', () => {
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 })
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 })
  assert.deepEqual(monthGrid(2026, 0), [])
})

test('league games stay on Alpha, Beta, and Gamma, with one dot per type', () => {
  const items = buildCalendarItems({
    events: [
      event({
        id: 'a',
        event_type: 'league_game',
        team_id: 'alpha-id',
        game_date: '2026-11-01',
        start_time: '08:45:00',
        opponent: 'Livermore Monks',
        ground: 'Anthony Ochoa Middle School',
        starts_at: '2026-11-01T16:45:00.000Z',
        result: 'win',
        match_status: 'completed',
        video_url: 'https://youtu.be/cheetahs-win',
      }),
      event({
        id: 'b',
        event_type: 'league_game',
        team_id: 'beta-id',
        game_date: '2026-11-01',
        start_time: '12:45:00',
        opponent: 'Cougars Black',
        starts_at: '2026-11-01T20:45:00.000Z',
        result: 'loss',
        match_status: 'completed',
      }),
      event({
        id: 'visitor',
        event_type: 'league_game',
        team_id: 'visitor-id',
        game_date: '2026-11-01',
        start_time: '09:00:00',
        opponent: 'Someone',
      }),
      event({
        id: 'practice',
        event_type: 'practice',
        game_date: '2026-11-11',
        start_time: '20:30:00',
        end_time: '22:00:00',
        opponent: 'Cheetahs practice',
        ground: 'US Cricket Store',
      }),
      event({
        id: 'umpire',
        event_type: 'umpiring',
        team_id: 'gamma-id',
        game_date: '2026-11-11',
        start_time: '10:00:00',
        opponent: 'Other clubs',
        ground: 'Central Park',
      }),
    ],
    activities: [],
    polls: [],
    dues: [],
    expenses: [],
    teams,
    asOf,
    teamsKnown: true,
  })

  const nov1 = groupCalendarItems(items).get('2026-11-01') ?? []
  assert.deepEqual(
    nov1.map((item) => item.title),
    ['Alpha vs Livermore Monks', 'Beta vs Cougars Black'],
  )
  assert.equal(nov1[0]?.timeLabel, '8:45 AM PT')
  assert.equal(nov1[0]?.venue, 'Anthony Ochoa Middle School')
  assert.equal(nov1[0]?.sideLabel, 'Alpha')
  assert.equal(nov1[0]?.kit, 'White Ball · Dress: Cheetahs Colors')
  assert.equal(nov1[0]?.showResult, true)
  assert.equal(nov1[0]?.result, 'win')
  assert.equal(nov1[0]?.videoUrl, 'https://youtu.be/cheetahs-win')
  assert.equal(nov1[0]?.href, '/schedules?view=list&side=alpha#fixture-a')
  assert.equal(nov1[1]?.result, 'loss')
  assert.deepEqual(dotsForDay(nov1), ['league'])

  const nov11 = groupCalendarItems(items).get('2026-11-11') ?? []
  assert.deepEqual(
    nov11.map((item) => [item.kind, item.timeLabel, item.title, item.sideLabel]),
    [
      ['umpiring', '10:00 AM PT', 'Other clubs', 'Gamma'],
      ['practice', '8:30 PM – 10:00 PM PT', 'Cheetahs practice', 'Club-wide'],
    ],
  )
  assert.equal(nov11[1]?.href, '/schedules?view=list&side=practice#fixture-practice')
  assert.deepEqual(dotsForDay(nov11), ['practice', 'umpiring'])
})

test('a future league game hides the result and gamma uses the pink kit', () => {
  const items = buildCalendarItems({
    events: [
      event({
        id: 'g',
        event_type: 'league_game',
        team_id: 'gamma-id',
        game_date: '2026-11-08',
        start_time: '08:45:00',
        opponent: 'All Stars United',
        ground: 'Ortega Park',
        starts_at: '2026-11-08T16:45:00.000Z',
      }),
    ],
    activities: [],
    polls: [],
    dues: [],
    expenses: [],
    teams,
    asOf,
    teamsKnown: true,
  })
  const item = items[0]
  assert.equal(item?.showResult, false)
  assert.equal(item?.kit, 'Pink Ball · Dress: Whites')
  assert.equal(item?.title, 'Gamma vs All Stars United')
})

test('activity series occurrences, poll closes, dues, and expenses land on Pacific days', () => {
  const dues: DuesAssessment = {
    id: 'due-1',
    title: 'Winter dues',
    description: null,
    amount: 5000,
    due_date: '2026-11-20',
    period_label: 'Winter',
    team_id: 'beta-id',
    member_id: 'member',
    expense_id: null,
    status: 'open',
    created_by: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
  }
  const waived: DuesAssessment = { ...dues, id: 'due-2', status: 'waived', title: 'Waived' }
  const expense: Expense = {
    id: 'exp-1',
    title: 'Balls',
    amount: 2400,
    currency: 'usd',
    expense_date: '2026-11-20',
    category: 'Gear',
    notes: null,
    team_id: null,
    created_by: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    archived_at: null,
  }
  const archived: Expense = { ...expense, id: 'exp-2', archived_at: '2026-11-02T00:00:00.000Z', title: 'Old' }
  const polls: Poll[] = [
    {
      id: 'poll-1',
      question: '<p>Whites or colors?</p>',
      description: null,
      created_by: null,
      created_at: '2026-11-01T00:00:00.000Z',
      closes_at: '2026-11-08T07:30:00.000Z',
      status: 'open',
    },
    {
      id: 'poll-2',
      question: 'No close',
      description: null,
      created_by: null,
      created_at: '2026-11-01T00:00:00.000Z',
      closes_at: null,
      status: 'open',
    },
  ]
  const items = buildCalendarItems({
    events: [],
    activities: [
      activity({
        id: 'act-1',
        title: 'Umpiring Certification NCCA',
        starts_at: '2026-11-15T17:30:00.000Z',
        ends_at: '2026-11-16T00:00:00.000Z',
        location: 'TBA',
        series_id: 'series-1',
      }),
      activity({
        id: 'act-2',
        title: 'Umpiring Certification NCCA',
        starts_at: '2026-11-22T17:30:00.000Z',
        ends_at: '2026-11-23T00:00:00.000Z',
        location: 'TBA',
        series_id: 'series-1',
      }),
    ],
    polls,
    dues: [dues, waived],
    expenses: [expense, archived],
    teams,
    asOf,
    teamsKnown: true,
  })
  const grouped = groupCalendarItems(items)
  const nov15 = grouped.get('2026-11-15') ?? []
  assert.equal(nov15.length, 1)
  assert.equal(nov15[0]?.timeLabel, '9:30 AM – 4:00 PM PT')
  assert.equal(nov15[0]?.venue, 'TBA')
  assert.equal(nov15[0]?.sideLabel, 'Club-wide')
  assert.equal(nov15[0]?.href, '/activities#activity-act-1')
  assert.equal(grouped.get('2026-11-22')?.[0]?.id, 'activity-act-2')

  const nov7 = grouped.get('2026-11-07') ?? []
  assert.equal(nov7[0]?.kind, 'poll')
  assert.equal(nov7[0]?.title, 'Whites or colors?')
  assert.equal(nov7[0]?.timeLabel, 'Closes 11:30 PM PT')
  assert.equal(nov7[0]?.href, '/polls#poll-poll-1')

  const nov20 = grouped.get('2026-11-20') ?? []
  const due = nov20.find((item) => item.kind === 'dues')
  const expenseItem = nov20.find((item) => item.kind === 'expense')
  assert.equal(due?.timeLabel, 'Due')
  assert.equal(due?.title, 'Winter dues')
  assert.equal(due?.sideLabel, 'Beta')
  assert.equal(due?.href, '/dues#due-due-1')
  assert.equal(expenseItem?.timeLabel, 'All day')
  assert.equal(expenseItem?.title, 'Balls')
  assert.deepEqual(dotsForDay(nov20), ['dues', 'expense'])
  assert.equal(items.some((item) => item.title === 'Waived' || item.title === 'Old' || item.title === 'No close'), false)
})

test('unknown teams still keep league games so a failed team load does not hide the month', () => {
  const items = buildCalendarItems({
    events: [
      event({
        id: 'a',
        event_type: 'league_game',
        team_id: 'alpha-id',
        game_date: '2026-11-07',
        start_time: '12:45:00',
        opponent: 'Strikers Blue 2',
        starts_at: '2026-11-07T20:45:00.000Z',
      }),
    ],
    activities: [],
    polls: [],
    dues: [],
    expenses: [],
    teams: [],
    asOf,
    teamsKnown: false,
  })
  assert.equal(items.length, 1)
  assert.equal(items[0]?.kind, 'league')
  assert.equal(items[0]?.showResult, false)
})
