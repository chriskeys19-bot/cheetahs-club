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
  duesPaymentStanding,
  duesPath,
  feeStatusLabel,
  duesUrl,
  explicitMemoToken,
  interpretFinanceSheet,
  isSplitsOnlyAccount,
  linkNames,
  matchSheetName,
  memberBalanceCents,
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
const PRANAV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CLUB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const roster: RosterPerson[] = [
  { id: ANMOL, fullName: 'Anmol Sharma' },
  { id: CHRIS, fullName: 'Christopher Agustian Selvaraj' },
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
  assert.equal(nameMatchScore('Christopher Selvaraj', 'Christopher Agustian Selvaraj'), 90)
  assert.equal(nameMatchScore('Chris', 'Christopher Agustian Selvaraj'), 55)
  assert.equal(nameMatchScore('Thyagy Krishnamurthy', 'Thyagy K'), null)
  assert.equal(nameMatchScore('Ben', 'Cheetahs Club'), null)
})

test('a short splits name links to the same profile when that full name is unique', () => {
  const clubRoster: RosterPerson[] = [...roster, { id: CLUB, fullName: 'Cheetahs Club' }, { id: PRANAV, fullName: 'Pranav Nandan' }]
  assert.equal(matchSheetName('Christopher Selvaraj', clubRoster, []), CHRIS)
  assert.equal(matchSheetName('Chris', clubRoster, []), CHRIS)
  assert.equal(matchSheetName('Ben', clubRoster, []), BEN)
  assert.equal(matchSheetName('Ben Thomas', clubRoster, []), BEN)
  assert.equal(matchSheetName('Cheetahs Club', clubRoster, []), null)
  assert.equal(matchSheetName('Pranav', clubRoster, []), PRANAV)
  const linked = linkNames(
    ['Chris', 'Christopher Selvaraj', 'Nalan', 'Nalan Karuppaiah', 'Ben', 'Ben Thomas', 'Pranav', 'Pranav Nandan', 'Cheetahs Club'],
    clubRoster,
    [],
  )
  assert.equal(linked.profileIdByKey.get('christopher selvaraj'), CHRIS)
  assert.equal(linked.profileIdByKey.get('chris'), CHRIS)
  assert.equal(linked.profileIdByKey.get('nalan karuppaiah'), NALAN)
  assert.equal(linked.profileIdByKey.get('nalan'), NALAN)
  assert.equal(linked.profileIdByKey.get('ben'), BEN)
  assert.equal(linked.profileIdByKey.get('ben thomas'), BEN)
  assert.equal(linked.profileIdByKey.get('pranav'), PRANAV)
  assert.equal(linked.profileIdByKey.get('pranav nandan'), PRANAV)
  assert.equal(linked.profileIdByKey.has('cheetahs club'), false)
  assert.deepEqual(linked.unmatched, ['Cheetahs Club'])
  const mapped = linkNames(['Chris', 'Christopher Selvaraj'], clubRoster, [{ sheetKey: 'chris', profileId: BEN }])
  assert.equal(mapped.profileIdByKey.get('chris'), BEN)
  assert.equal(mapped.profileIdByKey.get('christopher selvaraj'), CHRIS)
  assert.deepEqual(mapped.unmatched, [])
  const blocked = linkNames(['Chris'], clubRoster, [
    { sheetKey: 'chris', profileId: BEN },
    { sheetKey: 'chris', profileId: CHRIS },
  ])
  assert.equal(blocked.profileIdByKey.has('chris'), false)
  assert.deepEqual(blocked.unmatched, ['Chris'])
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
  const ambiguous = linkNames(['Ben', 'Ben Thomas', 'Ben Carter'], twoBens, [])
  assert.equal(ambiguous.profileIdByKey.has('ben'), false)
  assert.equal(ambiguous.profileIdByKey.get('ben thomas'), BEN)
  assert.equal(ambiguous.profileIdByKey.get('ben carter'), OTHER_BEN)
  assert.deepEqual(ambiguous.unmatched, ['Ben'])
})

test('Nalan on the dues tab and Nalan on splits are one balance, with the games as detail', () => {
  const duesRow = Array.from({ length: 14 }, () => '')
  duesRow[DUES_NAME_COL] = 'Nalan Karuppaiah'
  duesRow[DUES_STATUS_COL] = 'Active'
  duesRow[DUES_FEE_COL] = 100
  duesRow[DUES_GAMES_COL] = 40
  duesRow[DUES_BALANCE_COL] = -140
  const names = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  names[SPLIT_NAME_START] = 'Nalan'
  const game = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  game[SPLIT_DATE_COL] = '1/11/2026'
  game[SPLIT_TYPE_COL] = 'Game #1'
  game[SPLIT_NAME_START] = 25
  const water = Array.from({ length: SPLIT_RECON_COL + 1 }, () => '')
  water[SPLIT_DATE_COL] = '2/1/2026'
  water[SPLIT_TYPE_COL] = 'Game #2 Water'
  water[SPLIT_NAME_START] = 15
  const parsed = parseFinanceGrid({
    duesValues: [['', 'Name'], duesRow],
    splitsValues: [names, [], game, water],
    splitsStartRow: 2,
  })
  const dues = parsed.accounts.find((row) => row.sheetKey === 'nalan karuppaiah')
  const splits = parsed.accounts.find((row) => row.sheetKey === 'nalan')
  assert.ok(dues)
  assert.ok(splits)
  assert.equal(isSplitsOnlyAccount(dues), false)
  assert.equal(isSplitsOnlyAccount(splits), true)
  assert.equal(dues.balanceDueCents, -14000)
  assert.equal(splits.balanceDueCents, -4000)
  const linked = linkNames(parsed.names, roster, [])
  assert.equal(linked.profileIdByKey.get('nalan karuppaiah'), NALAN)
  assert.equal(linked.profileIdByKey.get('nalan'), NALAN)

  const accounts: SheetAccount[] = parsed.accounts.map((row) => ({
    ...row,
    id: row.sheetKey,
    profileId: linked.profileIdByKey.get(row.sheetKey) ?? null,
  }))
  const charges: SheetCharge[] = parsed.charges.map((row) => ({
    ...row,
    id: `${row.sheetKey}-${row.sheetRow}`,
    profileId: linked.profileIdByKey.get(row.sheetKey) ?? null,
  }))
  const ledger = buildPlayerLedger(accounts, charges)
  assert.equal(ledger.balanceDueCents, -14000)
  assert.equal(ledger.owedCents, 14000)
  assert.equal(ledger.totalPaidCents, 0)
  assert.equal(ledger.lines.find((line) => line.kind === 'membership')?.amountCents, 10000)
  assert.deepEqual(
    ledger.lines.filter((line) => line.kind === 'game').map((line) => [line.title, line.amountCents]),
    [
      ['Game dues', 2500],
      ['Water', 1500],
    ],
  )
  assert.equal(ledger.gapCents, 0)
  assert.equal(memberBalanceCents(accounts), -14000)

  const splitsOnly = buildPlayerLedger(
    accounts.filter((row) => row.sheetKey === 'nalan'),
    charges,
  )
  assert.equal(splitsOnly.balanceDueCents, -4000)
  assert.equal(splitsOnly.lines.filter((line) => line.kind === 'game').length, 2)
  assert.equal(memberBalanceCents(accounts.filter((row) => row.sheetKey === 'nalan')), -4000)
})

test('sheet fee status becomes a short standing, with partial pay and credit called out', () => {
  assert.deepEqual(feeStatusLabel('Pending Post'), {
    label: 'Paid (pending post)',
    detail: null,
    tone: 'pending',
  })
  assert.deepEqual(feeStatusLabel('Pending Post - Zelle 11/16'), {
    label: 'Paid (pending post)',
    detail: 'Zelle 11/16',
    tone: 'pending',
  })
  assert.equal(feeStatusLabel('Paid to Saro - Needs Validation')?.label, 'Paid to Saro, needs validation')
  assert.equal(feeStatusLabel('Paid - Validated')?.label, 'Paid')
  assert.equal(feeStatusLabel('credit claim under review')?.label, 'Credit claim under review')
  assert.equal(feeStatusLabel('Waitlist')?.label, 'Waitlist')
  const partial = duesPaymentStanding(
    account({
      sheetKey: 'partial',
      sheetName: 'Partial',
      clubFeeStatus: 'Paid - Validated',
      receivedTotalCents: 5000,
      balanceDueCents: -2500,
      paymentNotes: 'Zelle 11/16',
    }),
  )
  assert.equal(partial?.label, 'Paid')
  assert.equal(partial?.balanceLine, 'Partially paid, $25.00 remaining')
  assert.equal(partial?.notes, 'Zelle 11/16')
  const credit = duesPaymentStanding(
    account({
      sheetKey: 'credit',
      sheetName: 'Credit',
      clubFeeStatus: null,
      balanceDueCents: 55,
      paymentNotes: 'credit claim under review',
    }),
  )
  assert.equal(credit?.label, 'Credit claim under review')
  assert.equal(credit?.balanceLine, '$0.55 credit')
  const dated = duesPaymentStanding(
    account({
      sheetKey: 'post',
      sheetName: 'Post',
      clubFeeStatus: 'Pending Post',
      balanceDueCents: 0,
      receivedTotalCents: 100,
      paymentNotes: 'Zelle 11/16',
    }),
  )
  assert.equal(dated?.label, 'Paid (pending post)')
  assert.equal(dated?.detail, 'Zelle 11/16')
})

test('Rajesh Ravikumar stays paid at $0 when the Rajesh splits balance is linked', () => {
  const RAJESH = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const dues = account({
    sheetKey: 'rajesh ravikumar',
    sheetName: 'Rajesh Ravikumar',
    profileId: RAJESH,
    clubStatus: 'Active',
    clubFeeCents: 10000,
    clubFeeStatus: 'Paid - Validated',
    receivedTotalCents: 12673,
    gameChargesTotalCents: 2673,
    balanceDueCents: 0,
    paymentNotes: 'Paid in full',
  })
  const splits = account({
    sheetKey: 'rajesh',
    sheetName: 'Rajesh',
    profileId: RAJESH,
    clubStatus: null,
    balanceDueCents: -2673,
  })
  const people: RosterPerson[] = [...roster, { id: RAJESH, fullName: 'Rajesh Ravikumar' }]
  const linked = linkNames(['Rajesh Ravikumar', 'Rajesh'], people, [])
  assert.equal(linked.profileIdByKey.get('rajesh ravikumar'), RAJESH)
  assert.equal(linked.profileIdByKey.get('rajesh'), RAJESH)
  assert.equal(isSplitsOnlyAccount(splits), true)
  const ledger = buildPlayerLedger(
    [dues, splits],
    [charge({ sheetKey: 'rajesh', sheetName: 'Rajesh', amountCents: 2673, sheetRow: 12, profileId: RAJESH })],
  )
  assert.equal(ledger.balanceDueCents, 0)
  assert.equal(ledger.owedCents, 0)
  assert.equal(ledger.state, 'paid')
  assert.equal(ledger.standings.length, 1)
  assert.equal(ledger.standings[0]?.label, 'Paid')
  assert.equal(ledger.standings[0]?.tone, 'paid')
  assert.equal(ledger.standings[0]?.notes, 'Paid in full')
  assert.equal(ledger.standings[0]?.balanceLine, null)
  assert.equal(memberBalanceCents([dues, splits]), 0)
  assert.equal(ledger.lines.some((line) => line.kind === 'game' && line.amountCents === 2673), true)
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
