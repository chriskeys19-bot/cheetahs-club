import { SheetDuesView } from '../components/SheetDuesView.tsx'
import { buildPlayerLedger, zelleMemo, type LedgerExpense, type SheetAccount, type SheetCharge } from '../lib/sheetLedger.ts'

function account(patch: Partial<SheetAccount> & Pick<SheetAccount, 'sheetName' | 'balanceDueCents'>): SheetAccount {
  return {
    id: patch.sheetName,
    sheetKey: patch.sheetName.toLowerCase(),
    profileId: 'preview',
    clubStatus: 'Active',
    clubFeeCents: 0,
    clubFeeStatus: null,
    umpiringFeeCents: 0,
    umpiringStatus: null,
    receivedSaroCents: 0,
    receivedBenCents: 0,
    receivedTotalCents: 0,
    gameChargesTotalCents: null,
    paymentNotes: null,
    sheetCreditCents: 0,
    manualCreditCents: 0,
    ...patch,
  }
}

function charge(patch: Partial<SheetCharge> & Pick<SheetCharge, 'sheetRow' | 'amountCents' | 'chargeType' | 'chargeKind'>): SheetCharge {
  return {
    id: String(patch.sheetRow) + patch.chargeType,
    sheetKey: 'anmol',
    sheetName: 'Anmol',
    profileId: 'preview',
    chargeDate: '2026-01-11',
    gameLabel: 'Game #1',
    team: 'Alpha',
    ground: 'Milpitas',
    reconStatus: null,
    ...patch,
  }
}

const owedAccount = account({
  sheetName: 'Anmol',
  clubFeeCents: 10000,
  umpiringFeeCents: 2000,
  receivedTotalCents: 10000,
  gameChargesTotalCents: 4000,
  balanceDueCents: -6000,
  paymentNotes: 'Paid to Saro - membership',
})

const owed = buildPlayerLedger(
  [owedAccount],
  [
    charge({ sheetRow: 4, amountCents: 2500, chargeType: 'Game #1', chargeKind: 'dues', chargeDate: '2026-01-11' }),
    charge({
      sheetRow: 5,
      amountCents: 1500,
      chargeType: 'Game #1 Water',
      chargeKind: 'water',
      gameLabel: 'Game #1',
      chargeDate: '2026-01-11',
    }),
    charge({
      sheetRow: 8,
      amountCents: 3500,
      chargeType: 'Game #2',
      chargeKind: 'dues',
      gameLabel: 'Game #2',
      chargeDate: '2026-02-08',
      ground: 'Birch Grove',
    }),
    charge({
      sheetRow: 12,
      amountCents: 3500,
      chargeType: 'Game #3',
      chargeKind: 'dues',
      gameLabel: 'Game #3',
      chargeDate: '2026-02-15',
      ground: 'Fremont Central Park',
    }),
    charge({
      sheetRow: 16,
      amountCents: 3500,
      chargeType: 'Game #4',
      chargeKind: 'dues',
      gameLabel: 'Game #4',
      chargeDate: '2026-02-22',
      ground: 'Milpitas',
    }),
    charge({
      sheetRow: 20,
      amountCents: 3500,
      chargeType: 'Game #5',
      chargeKind: 'dues',
      gameLabel: 'Game #5',
      chargeDate: '2026-03-01',
      ground: 'Hayward',
    }),
  ],
)

const paid = buildPlayerLedger(
  [
    account({
      sheetName: 'Ben',
      clubFeeCents: 10000,
      receivedTotalCents: 10000,
      balanceDueCents: 0,
      paymentNotes: null,
      clubStatus: null,
    }),
  ],
  [],
)

const empty = buildPlayerLedger(
  [account({ sheetName: 'Saro', balanceDueCents: 0, clubStatus: null })],
  [],
)

const nalan = buildPlayerLedger(
  [
    account({
      sheetName: 'Nalan Karuppaiah',
      clubFeeCents: 10000,
      gameChargesTotalCents: 4000,
      balanceDueCents: -14000,
      clubStatus: 'Active',
    }),
    account({
      sheetName: 'Nalan',
      clubStatus: null,
      gameChargesTotalCents: null,
      balanceDueCents: -4000,
    }),
  ],
  [
    charge({
      sheetKey: 'nalan',
      sheetName: 'Nalan',
      sheetRow: 4,
      amountCents: 2500,
      chargeType: 'Game #1',
      chargeKind: 'dues',
    }),
    charge({
      sheetKey: 'nalan',
      sheetName: 'Nalan',
      sheetRow: 5,
      amountCents: 1500,
      chargeType: 'Game #2 Water',
      chargeKind: 'water',
      gameLabel: 'Game #2',
      chargeDate: '2026-02-01',
    }),
  ],
)

const rajesh = buildPlayerLedger(
  [
    account({
      sheetName: 'Rajesh Ravikumar',
      clubFeeCents: 10000,
      clubFeeStatus: 'Paid - Validated',
      receivedTotalCents: 12673,
      gameChargesTotalCents: 2673,
      balanceDueCents: 0,
      paymentNotes: 'Paid in full',
    }),
    account({
      sheetName: 'Rajesh',
      clubStatus: null,
      gameChargesTotalCents: null,
      balanceDueCents: -2673,
    }),
  ],
  [
    charge({
      sheetKey: 'rajesh',
      sheetName: 'Rajesh',
      sheetRow: 12,
      amountCents: 2673,
      chargeType: 'Game #3',
      chargeKind: 'dues',
      gameLabel: 'Game #3',
    }),
  ],
)

const benLedger = buildPlayerLedger(
  [
    account({
      sheetName: 'Ben Thomas',
      clubStatus: 'PT',
      receivedTotalCents: 6545,
      balanceDueCents: -455,
      sheetCreditCents: 45,
      manualCreditCents: 0,
      paymentNotes:
        "Online transfer from 3083 pending 11/16 $35.45 – games (Ben's own payment). +$0.45 credit = water share under old split model; shown automatically in Credits Available (auto) O. Manual P = 0.",
    }),
  ],
  [],
)

const SHARED_MEMO = '31631983768'

const benExpenses: LedgerExpense[] = [
  {
    key: 'game-1',
    sheetRow: 4,
    gameDate: '2026-10-04',
    team: 'Lions',
    gameNo: 1,
    ground: 'Hayward',
    duesCents: 3000,
    paidCents: 3000,
    unsettledCents: 0,
    memo: null,
  },
  {
    key: 'game-2',
    sheetRow: 6,
    gameDate: '2026-10-11',
    team: 'Alpha',
    gameNo: 2,
    ground: 'Birch Grove',
    duesCents: 3500,
    paidCents: 3500,
    unsettledCents: 0,
    memo: SHARED_MEMO,
  },
  {
    key: 'game-3',
    sheetRow: 8,
    gameDate: '2026-10-18',
    team: 'Alpha',
    gameNo: 3,
    ground: 'Milpitas',
    duesCents: 3500,
    paidCents: 3500,
    unsettledCents: 0,
    memo: SHARED_MEMO,
  },
  {
    key: 'game-4',
    sheetRow: 10,
    gameDate: '2026-10-25',
    team: 'Alpha',
    gameNo: 4,
    ground: 'Fremont Central Park',
    duesCents: 3500,
    paidCents: 0,
    unsettledCents: 3500,
    memo: SHARED_MEMO,
  },
  {
    key: 'game-5',
    sheetRow: 12,
    gameDate: '2026-11-02',
    team: 'Cheetahs',
    gameNo: 5,
    ground: 'Milpitas',
    duesCents: 3500,
    paidCents: 0,
    unsettledCents: 3500,
    memo: '   ',
  },
  {
    key: 'game-6',
    sheetRow: 14,
    gameDate: '2026-11-08',
    team: 'Cheetahs',
    gameNo: 6,
    ground: 'Birch Grove',
    duesCents: 3500,
    paidCents: 3500,
    unsettledCents: 0,
    memo: null,
  },
  {
    key: 'game-7',
    sheetRow: 16,
    gameDate: '2026-11-14',
    team: 'Cheetahs',
    gameNo: 7,
    ground: 'Fremont Central Park',
    duesCents: 3500,
    paidCents: 45,
    unsettledCents: 3455,
    memo: 'Online transfer from 3083 pending 11/16',
  },
]

const synced = '2026-11-14T20:40:00.000Z'

export function SheetDuesPreviewPage() {
  return (
    <main className="page dues-desk">
      <header className="page-intro span-all">
        <p className="kicker">Preview</p>
        <h1>Sheet dues states</h1>
        <p className="lede">Fixture data for the winter sheet. These rows are not from Supabase.</p>
      </header>
      <SheetDuesView
        loading={false}
        error={null}
        notice={null}
        memberName="Ben Thomas"
        ledger={benLedger}
        expenses={benExpenses}
        syncedAt={synced}
        lastAttemptFailed={false}
        lastAttemptAt={null}
        syncSource="scheduled"
        syncError={null}
        zelleEmail="treasurercheetahscricket@gmail.com"
        memo={zelleMemo('Ben Thomas', null, '1116')}
        showSync={false}
        refreshing={false}
        refreshError={null}
        onRefresh={null}
        duesLink={null}
        wrongLink={false}
        invalidLink={false}
        headingId="preview-ledger"
      />
      <SheetDuesView
        loading={false}
        error={null}
        notice={null}
        memberName="Anmol Sharma"
        ledger={owed}
        syncedAt={synced}
        lastAttemptFailed={false}
        lastAttemptAt={null}
        syncSource="scheduled"
        syncError={null}
        zelleEmail="treasurercheetahscricket@gmail.com"
        memo={zelleMemo('Anmol Sharma', null, '1114')}
        showSync={false}
        refreshing={false}
        refreshError={null}
        onRefresh={null}
        duesLink="https://cheetahs-club.pages.dev/dues/11111111-1111-4111-8111-111111111111"
        wrongLink={false}
        invalidLink={false}
        headingId="preview-owed"
      />
      <SheetDuesView
        loading={false}
        error={null}
        notice={null}
        memberName="Ben Thomas"
        ledger={paid}
        syncedAt={synced}
        lastAttemptFailed={false}
        lastAttemptAt={null}
        syncSource="manual"
        syncError={null}
        zelleEmail="treasurercheetahscricket@gmail.com"
        memo={zelleMemo('Ben Thomas', null, '1114')}
        showSync={false}
        refreshing={false}
        refreshError={null}
        onRefresh={null}
        duesLink={null}
        wrongLink={false}
        invalidLink={false}
        headingId="preview-paid"
      />
      <SheetDuesView
        loading={false}
        error={null}
        notice={null}
        memberName="Saravanan Manickavasagam"
        ledger={empty}
        syncedAt={synced}
        lastAttemptFailed={false}
        lastAttemptAt={null}
        syncSource="scheduled"
        syncError={null}
        zelleEmail="treasurercheetahscricket@gmail.com"
        memo={zelleMemo('Saravanan Manickavasagam', null, '1114')}
        showSync={false}
        refreshing={false}
        refreshError={null}
        onRefresh={null}
        duesLink={null}
        wrongLink={false}
        invalidLink={false}
        headingId="preview-empty"
      />
      <SheetDuesView
        loading={false}
        error={null}
        notice={null}
        memberName="Nalan Karuppaiah"
        ledger={nalan}
        syncedAt={synced}
        lastAttemptFailed={false}
        lastAttemptAt={null}
        syncSource="scheduled"
        syncError={null}
        zelleEmail="treasurercheetahscricket@gmail.com"
        memo={zelleMemo('Nalan Karuppaiah', null, '1114')}
        showSync={false}
        refreshing={false}
        refreshError={null}
        onRefresh={null}
        duesLink={null}
        wrongLink={false}
        invalidLink={false}
        headingId="preview-nalan"
      />
      <SheetDuesView
        loading={false}
        error={null}
        notice={null}
        memberName="Rajesh Ravikumar"
        ledger={rajesh}
        syncedAt={synced}
        lastAttemptFailed={false}
        lastAttemptAt={null}
        syncSource="scheduled"
        syncError={null}
        zelleEmail="treasurercheetahscricket@gmail.com"
        memo={zelleMemo('Rajesh Ravikumar', null, '1114')}
        showSync={false}
        refreshing={false}
        refreshError={null}
        onRefresh={null}
        duesLink={null}
        wrongLink={false}
        invalidLink={false}
        headingId="preview-rajesh"
      />
    </main>
  )
}
