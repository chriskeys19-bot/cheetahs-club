import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILTIN_ALIASES,
  DUES_BALANCE_COL,
  DUES_BEN_COL,
  DUES_FEE_COL,
  DUES_FEE_STATUS_COL,
  DUES_GAMES_COL,
  DUES_NAME_COL,
  DUES_NOTES_COL,
  DUES_RECEIVED_COL,
  DUES_SARO_COL,
  DUES_STATUS_COL,
  DUES_UMPIRING_COL,
  HELPER_SPLIT_ROW,
  SPLIT_DATE_COL,
  SPLIT_GROUND_COL,
  SPLIT_NAME_START,
  SPLIT_RECON_COL,
  SPLIT_TEAM_COL,
  SPLIT_TYPE_COL,
  buildPlayerLedger,
  chargeGroupHeading,
  describeCharge,
  duesPath,
  duesUrl,
  explicitMemoToken,
  interpretFinanceSheet,
  linkNames,
  matchSheetName,
  memberIdFromParam,
  memoToken,
  nameMatchScore,
  normalizeName,
  parseFinanceGrid,
  parseSheetDate,
  parseSheetMoney,
  zelleMemo,
  type NameMap,
  type RosterPerson,
  type SheetAccount,
  type SheetCharge,
} from './sheetLedger.ts'

const ANMOL = '11111111-1111-4111-8111-111111111111'
const CHRIS = '22222222-2222-4222-8222-222222222222'
const SARO = '33333333-3333-4333-8333-333333333333'
const SRINI = '44444444-4444-4444-8444-444444444444'
const SUNDAR = '55555555-5555-4555-8555-555555555555'
const SAI = '66666666-6666-4666-8666-666666666666'
const NALAN = '77777777-7777-4777-8777-777777777777'
const ANUJ = '88888888-8888-4888-8888-888888888888'
const BEN = '99999999-9999-4999-8999-999999999999'
const OTHER_BEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const roster: RosterPerson[] = [
  { id: ANMOL, fullName: 'Anmol Sharma' },
  { id: CHRIS, fullName: 'Christopher Selvaraj' },
  { id: SARO, fullName: 'Saravanan Manickavasagam' },
  { id: SRINI, fullName: 'Srivatsan Srinivasan' },
  { id: SUNDAR, fullName: 'Srivatsan Sundararajan' },
  { id: SAI, fullName: 'Sai Kumar' },
  { id: NALAN, fullName: 'Nalan Karuppaiah' },
  { id: ANUJ, fullName: 'Anuj Patel' },
  { id: BEN, fullName: 'Ben Thomas' },
]

function account(patch: Partial<SheetAccount> & Pick<SheetAccount, 'sheetKey' | 'sheetName'>): SheetAccount {
  return {
    id: patch.id ?? patch.sheetKey,
    profileId: patch.profileId ?? null,
    clubStatus: null,
    clubFeeCents: 0,
    clubFeeStatus: null,
    umpiringFeeCents: 0,
    umpiringStatus: null,
    receivedSaroCents: 0,
    receivedBenCents: 0,
    receivedTotalCents: 0,
    gameChargesTotalCents: null,
    balanceDueCents: 0,
    paymentNotes: null,
    ...patch,
  }
}

function charge(patch: Partial<SheetCharge> & Pick<SheetCharge, 'sheetKey' | 'amountCents' | 'sheetRow'>): SheetCharge {
  return {
    id: patch.id ?? `${patch.sheetKey}-${patch.sheetRow}`,
    sheetName: patch.sheetName ?? patch.sheetKey,
    profileId: null,
    chargeDate: '2026-01-11',
    chargeType: 'Game #1',
    gameLabel: 'Game #1',
    chargeKind: 'dues',
    team: 'Alpha',
    ground: 'Milpitas',
    reconStatus: null,
    ...patch,
  }
}

test('normalize trims the trailing space on Nalan and folds case', () => {
  assert.equal(normalizeName('Nalan '), 'nalan')
  assert.equal(normalizeName('  Sai   Saketh '), 'sai saketh')
  assert.equal(BUILTIN_ALIASES.nalan, 'nalan karuppaiah')
})

test('aliases and first names match one member, and the two Srivatsans stay apart', () => {
  const maps: NameMap[] = []
  assert.equal(matchSheetName('Anamol', roster, maps), ANMOL)
  assert.equal(matchSheetName('Anirdh', roster, maps), null)
  assert.equal(matchSheetName('Anirdh', [...roster, { id: 'anirdh-id', fullName: 'Anirudh Rao' }], maps), 'anirdh-id')
  assert.equal(matchSheetName('Chris', roster, maps), CHRIS)
  assert.equal(matchSheetName('Saro', roster, maps), SARO)
  assert.equal(matchSheetName('Sankar', [...roster, { id: 'shankar', fullName: 'Shankar Iyer' }], maps), 'shankar')
  assert.equal(matchSheetName('Sai Saketh', roster, maps), SAI)
  assert.equal(matchSheetName('Nalan ', roster, maps), NALAN)
  assert.equal(matchSheetName('Anuk', roster, maps), ANUJ)
  assert.equal(matchSheetName('Ben', roster, maps), BEN)
  assert.equal(matchSheetName('Ben Thomas', roster, maps), BEN)
  assert.equal(matchSheetName('Srivatsan', roster, maps), null)
  assert.equal(matchSheetName('Srivatsan Srini', roster, maps), SRINI)
  assert.equal(matchSheetName('Srivatsan Srinivasan', roster, maps), SRINI)
  assert.equal(matchSheetName('Srivatsan Sundar', roster, maps), SUNDAR)
  assert.equal(matchSheetName('Srivatsan Sundararajan', roster, maps), SUNDAR)
  assert.equal(nameMatchScore('Srivatsan', 'Srivatsan Srinivasan'), 60)
  assert.equal(nameMatchScore('Srivatsan Srini', 'Srivatsan Sundararajan'), null)
})

test('an admin map wins, and two people with the same first name stay unmatched', () => {
  const maps: NameMap[] = [{ sheetKey: 'anamol', profileId: BEN }]
  assert.equal(matchSheetName('Anamol', roster, maps), BEN)
  const twoBens: RosterPerson[] = [...roster, { id: OTHER_BEN, fullName: 'Ben Carter' }]
  assert.equal(matchSheetName('Ben', twoBens, []), null)
  assert.equal(matchSheetName('Ben Thomas', twoBens, []), BEN)
  const linked = linkNames(['Anamol', 'Srivatsan', 'Nobody'], roster, [])
  assert.equal(linked.profileIdByKey.get('anamol'), ANMOL)
  assert.deepEqual(linked.unmatched, ['Nobody', 'Srivatsan'])
})

test('payments cover membership, then umpiring, then the oldest game', () => {
  const ledger = buildPlayerLedger(
    [
      account({
        sheetKey: 'anmol',
        sheetName: 'Anmol',
        clubFeeCents: 10000,
        clubFeeStatus: null,
        umpiringFeeCents: 2000,
        umpiringStatus: '',
        receivedTotalCents: 13000,
        gameChargesTotalCents: 4000,
        balanceDueCents: 13000 - 4000 - 10000 - 2000,
        paymentNotes: 'Paid to Saro - membership',
      }),
    ],
    [
      charge({
        sheetKey: 'anmol',
        amountCents: 1500,
        sheetRow: 8,
        chargeDate: '2026-02-01',
        chargeType: 'Game #2 Water',
        gameLabel: 'Game #2',
        chargeKind: 'water',
      }),
      charge({
        sheetKey: 'anmol',
        amountCents: 2500,
        sheetRow: 4,
        chargeDate: '2026-01-11',
        chargeType: 'Game #1',
        chargeKind: 'dues',
      }),
    ],
  )
  assert.equal(ledger.state, 'owed')
  assert.equal(ledger.totalPaidCents, 13000)
  assert.equal(ledger.totalUnpaidCents, 3000)
  assert.equal(ledger.balanceDueCents, -3000)
  assert.equal(ledger.owedCents, 3000)
  assert.deepEqual(
    ledger.lines.map((line) => [line.title, line.status]),
    [
      ['Membership', 'Paid'],
      ['Umpiring fee', 'Paid'],
      ['Game dues', 'Unpaid'],
      ['Water', 'Unpaid'],
    ],
  )
  assert.equal(ledger.lines[2]?.appliedCents, 1000)
  assert.equal(ledger.paymentNotes, 'Paid to Saro - membership')
  assert.equal(ledger.gapCents, 0)
  assert.equal(ledger.groups[0] && chargeGroupHeading(ledger.groups[0]), 'Game #1 · Alpha · Milpitas')
  assert.equal(ledger.groups[1]?.gameLabel, 'Game #2')
})

test('a covered balance is all paid, a blank sheet is empty, and a credit has no amount owed', () => {
  const paid = buildPlayerLedger(
    [account({ sheetKey: 'a', sheetName: 'A', clubFeeCents: 5000, receivedTotalCents: 5000, balanceDueCents: 0 })],
    [],
  )
  assert.equal(paid.state, 'paid')
  assert.equal(paid.lines[0]?.status, 'Paid')
  assert.equal(paid.owedCents, 0)

  const empty = buildPlayerLedger(
    [account({ sheetKey: 'a', sheetName: 'A', balanceDueCents: 0 })],
    [],
  )
  assert.equal(empty.state, 'empty')
  assert.equal(empty.lines.length, 0)

  const credit = buildPlayerLedger(
    [account({ sheetKey: 'a', sheetName: 'A', clubFeeCents: 5000, receivedTotalCents: 8000, balanceDueCents: 3000 })],
    [],
  )
  assert.equal(credit.state, 'paid')
  assert.equal(credit.creditCents, 3000)
  assert.equal(credit.totalUnpaidCents, 0)

  assert.equal(buildPlayerLedger([], []).state, 'absent')
})

test('blank money and a blank status do not throw and leave the fee unpaid', () => {
  assert.equal(parseSheetMoney(''), null)
  assert.equal(parseSheetMoney(null), null)
  assert.equal(parseSheetMoney('#N/A'), null)
  assert.equal(parseSheetMoney('$1,234.50'), 123450)
  assert.equal(parseSheetMoney('(12.50)'), -1250)
  assert.equal(parseSheetMoney('12.5'), 1250)
  const ledger = buildPlayerLedger(
    [
      account({
        sheetKey: 'a',
        sheetName: 'A',
        clubFeeCents: 10000,
        clubFeeStatus: null,
        receivedTotalCents: 0,
        balanceDueCents: -10000,
      }),
    ],
    [charge({ sheetKey: 'a', amountCents: 0, sheetRow: 4 })],
  )
  assert.equal(ledger.lines.length, 1)
  assert.equal(ledger.lines[0]?.status, 'Unpaid')
})

test('sheet grids skip the header and helper row and keep each player amount', () => {
  const duesHeader = Array.from({ length: 14 }, () => '')
  duesHeader[DUES_NAME_COL] = 'Name'
  const anmol = Array.from({ length: 14 }, () => '')
  anmol[DUES_NAME_COL] = 'Anamol'
  anmol[DUES_STATUS_COL] = 'Active'
  anmol[DUES_FEE_COL] = '$100'
  anmol[DUES_FEE_STATUS_COL] = ''
  anmol[DUES_UMPIRING_COL] = ''
  anmol[DUES_SARO_COL] = '100'
  anmol[DUES_BEN_COL] = ''
  anmol[DUES_RECEIVED_COL] = '100'
  anmol[DUES_GAMES_COL] = '15'
  anmol[DUES_BALANCE_COL] = '-15'
  anmol[DUES_NOTES_COL] = 'Paid to Saro - membership'

  const names = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  names[SPLIT_NAME_START] = 'Anamol'
  names[SPLIT_NAME_START + 1] = 'Srivatsan Srini'
  names[SPLIT_NAME_START + 2] = 'Srivatsan Sundar'
  const game = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  game[SPLIT_DATE_COL] = '1/11/2026'
  game[SPLIT_TYPE_COL] = 'Game #1 Water'
  game[SPLIT_TEAM_COL] = 'Alpha'
  game[SPLIT_GROUND_COL] = 'Milpitas'
  game[SPLIT_NAME_START] = '5'
  game[SPLIT_NAME_START + 1] = '6'
  game[SPLIT_NAME_START + 2] = ''
  game[SPLIT_RECON_COL] = 'Open'
  const helper = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  helper[SPLIT_TYPE_COL] = 'Helper'
  helper[SPLIT_NAME_START] = '999'
  const later = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  later[SPLIT_DATE_COL] = 'Jan 18, 2026'
  later[SPLIT_TYPE_COL] = 'Game #2 Umpire'
  later[SPLIT_TEAM_COL] = 'Beta'
  later[SPLIT_GROUND_COL] = 'Hayward'
  later[SPLIT_NAME_START] = '4'
  const blank = Array.from({ length: 8 }, () => '')
  const rows: unknown[][] = []
  rows[0] = names
  rows[2] = game
  rows[HELPER_SPLIT_ROW - 2] = helper
  rows[HELPER_SPLIT_ROW - 1] = later
  rows[HELPER_SPLIT_ROW] = blank

  const parsed = parseFinanceGrid({
    duesValues: [duesHeader, anmol],
    splitsValues: rows,
    splitsStartRow: 2,
  })
  assert.equal(parsed.accounts.length, 2)
  assert.equal(parsed.names.includes('Srivatsan Sundar'), true)
  const anmolAccount = parsed.accounts.find((row) => row.sheetKey === 'anamol')
  assert.equal(anmolAccount?.clubFeeCents, 10000)
  assert.equal(anmolAccount?.balanceDueCents, -1500)
  assert.equal(anmolAccount?.clubFeeStatus, null)
  assert.equal(anmolAccount?.paymentNotes, 'Paid to Saro - membership')
  const anmolCharges = parsed.charges.filter((row) => row.sheetKey === 'anamol')
  assert.deepEqual(
    anmolCharges.map((row) => [row.sheetRow, row.chargeKind, row.amountCents, row.chargeDate, row.team]),
    [
      [4, 'water', 500, '2026-01-11', 'Alpha'],
      [511, 'umpire', 400, '2026-01-18', 'Beta'],
    ],
  )
  assert.equal(parsed.charges.some((row) => row.sheetRow === HELPER_SPLIT_ROW), false)
  assert.equal(parsed.charges.some((row) => row.amountCents === 99900), false)
  const srini = parsed.charges.find((row) => row.sheetKey === 'srivatsan srini')
  assert.equal(srini?.amountCents, 600)
  assert.equal(describeCharge('Game #1').title, 'Game dues')
  assert.equal(describeCharge('Game #1 Water').chargeKind, 'water')
  assert.equal(describeCharge('Game #2 Umpire share').title, 'Umpire share')
})

test('a bad sheet response and a missing grid do not throw', () => {
  assert.equal('error' in interpretFinanceSheet(500, { error: 'nope' }), true)
  assert.equal('error' in interpretFinanceSheet(200, { ok: false, error: 'unauthorized' }), true)
  assert.equal('error' in interpretFinanceSheet(200, { ok: true, dues: { values: [] }, splits: { values: [] } }), true)
  const ok = interpretFinanceSheet(200, {
    ok: true,
    dues: { startRow: 1, values: [['', 'Name'], ['', 'Ben']] },
    splits: { startRow: 2, values: [['Date']] },
  })
  assert.equal('accounts' in ok, true)
  if ('accounts' in ok) {
    assert.equal(ok.accounts[0]?.sheetName, 'Ben')
    assert.equal(ok.accounts[0]?.balanceDueCents, 0)
  }
})

test('dates accept the formats a formatted sheet cell uses', () => {
  assert.equal(parseSheetDate('1/11/2026'), '2026-01-11')
  assert.equal(parseSheetDate('2026-01-11'), '2026-01-11')
  assert.equal(parseSheetDate('Jan 11, 2026'), '2026-01-11')
  assert.equal(parseSheetDate('11-Jan-2026'), '2026-01-11')
  assert.equal(parseSheetDate(''), null)
  assert.equal(parseSheetDate('Helper'), null)
})

test('Zelle memos are one uppercase string and the Srivatsans keep distinct tokens', () => {
  assert.equal(zelleMemo('Anmol Sharma', null, '1114'), 'CHW26ANMOL1114')
  assert.equal(zelleMemo('Srivatsan Srinivasan', null, '1114'), 'CHW26SRIVATSANSR1114')
  assert.equal(zelleMemo('Srivatsan Sundararajan', null, '0131'), 'CHW26SRIVATSANSU0131')
  assert.equal(zelleMemo('Srivatsan Srinivasan', 'CHW26SRIVATSANSR1114', '1201'), 'CHW26SRIVATSANSR1201')
  assert.equal(memoToken('Ben Thomas', ' srivatsan su '), 'SRIVATSANSU')
  assert.equal(explicitMemoToken(''), null)
  assert.equal(explicitMemoToken('CHW26SRIVATSANSR1114'), 'SRIVATSANSR')
  assert.equal(zelleMemo(null, null, '9999'), 'CHW26MEMBER1114')
  assert.equal(zelleMemo('Ben', null, null), 'CHW26BEN1114')
  assert.equal(memberIdFromParam(ANMOL.toUpperCase()), ANMOL)
  assert.equal(memberIdFromParam('anmol'), null)
  assert.equal(duesPath(ANMOL), `/dues/${ANMOL}`)
  assert.equal(duesUrl('https://cheetahs-club.pages.dev/', ANMOL), `https://cheetahs-club.pages.dev/dues/${ANMOL}`)
  assert.equal(duesUrl('https://cheetahs-club.pages.dev', null), 'https://cheetahs-club.pages.dev/dues')
})
