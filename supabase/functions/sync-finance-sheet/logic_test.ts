import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLedgerGrid } from '../../../src/lib/sheetLedger.ts'
import { readFinanceRequest, relinkPayload, replacePayload, sheetReadBody } from './logic.ts'

const ANMOL = '11111111-1111-4111-8111-111111111111'
const BEN = '22222222-2222-4222-8222-222222222222'

test('a scheduled call and a rematch are the only requests', () => {
  assert.deepEqual(readFinanceRequest(null), { rematch: false })
  assert.deepEqual(readFinanceRequest({}), { rematch: false })
  assert.deepEqual(readFinanceRequest({ rematch: true }), { rematch: true })
  assert.equal(typeof readFinanceRequest({ rematch: 'yes' }), 'string')
  assert.equal(typeof readFinanceRequest([]), 'string')
})

test('the sheet read asks for read and nothing else', () => {
  const body = JSON.parse(sheetReadBody('secret-value')) as { secret: string; action: string }
  assert.deepEqual(body, { secret: 'secret-value', action: 'read' })
})

test('a replace payload links aliases and leaves the two Srivatsans unmatched', () => {
  const payload = replacePayload(
    [
      {
        sheetKey: 'anamol',
        sheetName: 'Anamol',
        clubStatus: null,
        clubFeeCents: 10000,
        clubFeeStatus: null,
        umpiringFeeCents: 0,
        umpiringStatus: null,
        receivedSaroCents: 0,
        receivedBenCents: 0,
        receivedTotalCents: 0,
        gameChargesTotalCents: null,
        balanceDueCents: -10000,
        paymentNotes: null,
        sheetCreditCents: 0,
        manualCreditCents: 0,
      },
    ],
    [],
    ['Anamol', 'Srivatsan', 'Srivatsan Srini'],
    [
      { id: ANMOL, fullName: 'Anmol Sharma' },
      { id: 'srini', fullName: 'Srivatsan Srinivasan' },
      { id: 'sundar', fullName: 'Srivatsan Sundararajan' },
    ],
    [],
    '2026-11-14T20:40:00.000Z',
    'scheduled',
  )
  assert.equal(payload.mode, 'replace')
  assert.equal(payload.sync_source, 'scheduled')
  const accounts = payload.accounts as { sheet_key: string; profile_id: string | null }[]
  assert.equal(accounts[0]?.profile_id, ANMOL)
  assert.deepEqual(payload.unmatched_names, ['Srivatsan'])
})

test('an admin map is what a relink applies', () => {
  const payload = relinkPayload(
    [{ sheetKey: 'srivatsan', sheetName: 'Srivatsan' }],
    [{ sheetKey: 'srivatsan', sheetName: 'Srivatsan' }, { sheetKey: 'srivatsan', sheetName: 'Srivatsan' }],
    [
      { id: BEN, fullName: 'Srivatsan Srinivasan' },
      { id: 'other', fullName: 'Srivatsan Sundararajan' },
    ],
    [{ sheetKey: 'srivatsan', profileId: BEN }],
  )
  const accounts = payload.accounts as { profile_id: string | null }[]
  const charges = payload.charges as { profile_id: string | null }[]
  assert.equal(accounts.length, 1)
  assert.equal(charges.length, 1)
  assert.equal(accounts[0]?.profile_id, BEN)
  assert.equal(charges[0]?.profile_id, BEN)
  assert.deepEqual(payload.unmatched_names, [])
})

test('a ledger row uses the same name match, and an old sheet omits the ledger', () => {
  const rows = parseLedgerGrid(
    [
      ['Date', 'Team', 'Game #', 'Ground', 'Player', 'Dues', 'Allocated paid', 'Unsettled', 'Status', 'Memo', 'Source'],
      ['2026-11-14', 'Cheetahs', 3, 'Fremont Central Park', 'Anamol', 35, 0.45, 34.55, 'Partial', 'water share', 'GC Splits!N9'],
      ['2026-11-14', 'Cheetahs', 3, 'Fremont Central Park', 'Ben', 35, 35, 0, 'Paid', '', 'GC Splits!N10'],
      ['2026-11-14', 'Cheetahs', 3, 'Fremont Central Park', 'Cheetahs Club', 35, 0, 35, 'Open', '', 'GC Splits!N11'],
    ],
    3,
  )
  const payload = replacePayload(
    [],
    [],
    [],
    [
      { id: ANMOL, fullName: 'Anmol Sharma' },
      { id: BEN, fullName: 'Ben Thomas' },
      { id: 'club', fullName: 'Cheetahs Club' },
    ],
    [{ sheetKey: 'ben', profileId: BEN }],
    '2026-11-16T14:40:00.000Z',
    'manual',
    rows,
  )
  const ledger = payload.ledger as { sheet_name: string; profile_id: string | null; paid_cents: number; unsettled_cents: number; memo: string | null }[]
  assert.equal(ledger.length, 3)
  assert.equal(ledger.find((row) => row.sheet_name === 'Anamol')?.profile_id, ANMOL)
  assert.equal(ledger.find((row) => row.sheet_name === 'Ben')?.profile_id, BEN)
  assert.equal(ledger.find((row) => row.sheet_name === 'Cheetahs Club')?.profile_id, null)
  assert.equal(ledger[0]?.paid_cents, 45)
  assert.equal(ledger[0]?.unsettled_cents, 3455)
  assert.equal(ledger[0]?.memo, 'water share')
  assert.deepEqual(payload.unmatched_names, ['Cheetahs Club'])

  const withoutLedger = replacePayload([], [], ['Anamol'], [{ id: ANMOL, fullName: 'Anmol Sharma' }], [], '2026-11-16T14:40:00.000Z', 'scheduled', null)
  assert.equal('ledger' in withoutLedger, false)
})
