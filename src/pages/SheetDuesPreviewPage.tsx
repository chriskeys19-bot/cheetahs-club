import { SheetDuesView } from '../components/SheetDuesView.tsx'
import { buildPlayerLedger, zelleMemo, type SheetAccount, type SheetCharge } from '../lib/sheetLedger.ts'

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
