import assert from 'node:assert/strict'
import test from 'node:test'
import { parseStreamScorecardUrl, readJobId, readStreamJobRequest, webhookCall } from './logic.ts'

const GAME = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'

test('create sends only the key name', () => {
  const parsed = readStreamJobRequest({
    scheduleEventId: GAME.toUpperCase(),
    action: 'create',
    streamKeyName: '  Yolobox Pro 2  ',
  })
  assert.deepEqual(parsed, {
    scheduleEventId: GAME,
    action: 'create',
    payload: { stream_key_name: 'Yolobox Pro 2' },
  })
})

test('key values are rejected', () => {
  assert.equal(
    readStreamJobRequest({ scheduleEventId: GAME, action: 'create', streamKeyName: 'Yolobox Pro 1', streamKey: 'secret' }),
    'Stream key values are not stored.',
  )
})

test('scorecard must be a cricclubs URL', () => {
  assert.equal(parseStreamScorecardUrl('https://cricclubs.com/Cheetahs/viewScorecard.do?matchId=9'), 'https://cricclubs.com/Cheetahs/viewScorecard.do?matchId=9')
  assert.equal(
    parseStreamScorecardUrl('http://www.cricclubs.com/Cheetahs/score'),
    'https://www.cricclubs.com/Cheetahs/score',
  )
  assert.equal(parseStreamScorecardUrl('https://example.com/cricclubs.com'), 'invalid')
  assert.equal(parseStreamScorecardUrl(''), null)
  const parsed = readStreamJobRequest({
    scheduleEventId: GAME,
    action: 'add_scorecard',
    scorecardUrl: 'https://cricclubs.com/Cheetahs/viewScorecard.do?matchId=9',
  })
  assert.equal(typeof parsed === 'string' ? parsed : parsed.payload.scorecard_url.startsWith('https://cricclubs.com/'), true)
})

test('end has an empty payload', () => {
  assert.deepEqual(readStreamJobRequest({ scheduleEventId: GAME, action: 'end' }), {
    scheduleEventId: GAME,
    action: 'end',
    payload: {},
  })
})

test('webhook sends the job id with both secret headers', () => {
  assert.equal(webhookCall('', 'key', JOB), null)
  assert.equal(webhookCall('https://bot.example/hook', '', JOB), null)
  const call = webhookCall('https://bot.example/hook', 'club-secret', JOB)
  assert.ok(call)
  assert.equal(call?.body, JSON.stringify({ job_id: JOB }))
  assert.equal(call?.headers.Authorization, 'Bearer club-secret')
  assert.equal(call?.headers['X-Webhook-Key'], 'club-secret')
  assert.equal(call?.body.includes('club-secret'), false)
})

test('job id comes back from the RPC payload', () => {
  assert.equal(readJobId({ job_id: JOB.toUpperCase() }), JOB)
  assert.equal(readJobId({ job_id: 'nope' }), null)
})
