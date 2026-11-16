import { useEffect, useState } from 'react'
import { buildPlayerLedger, duesUrl, zelleMemo, type LedgerExpense } from '../lib/sheetLedger.ts'
import { loadSheetMember, syncFinanceSheet, type SheetMemberDesk } from '../lib/sheetDues.ts'
import { SheetDuesView } from './SheetDuesView.tsx'

const emptyDesk: SheetMemberDesk = {
  settings: {
    zelleEmail: 'treasurercheetahscricket@gmail.com',
    reminderMmdd: '1114',
  },
  meta: null,
  status: null,
  accounts: [],
  charges: [],
  ledgerRows: [],
  memo: null,
  roster: [],
}

export function SheetDuesSection({
  memberId,
  staff,
  isAdmin,
  selfName,
  viewingSelf,
  wrongLink,
  invalidLink,
}: {
  memberId: string
  staff: boolean
  isAdmin: boolean
  selfName: string | null
  viewingSelf: boolean
  wrongLink: boolean
  invalidLink: boolean
}) {
  const [desk, setDesk] = useState<SheetMemberDesk>(emptyDesk)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancel = false
    loadSheetMember({ memberId, staff }).then((result) => {
      if (cancel) return
      setDesk(result.desk)
      setError(result.error)
      setLoading(false)
    })
    return () => {
      cancel = true
    }
  }, [memberId, staff, token])

  const rosterName = desk.roster.find((row) => row.id === memberId)?.fullName ?? null
  const memberName = viewingSelf ? selfName : rosterName
  const ledger = loading || error ? null : buildPlayerLedger(desk.accounts, desk.charges)
  const expenses: LedgerExpense[] = desk.ledgerRows.map((row) => ({
    key: row.id,
    sheetRow: row.sheetRow,
    gameDate: row.gameDate,
    team: row.team,
    gameNo: row.gameNo,
    ground: row.ground,
    duesCents: row.duesCents,
    paidCents: row.paidCents,
    unsettledCents: row.unsettledCents,
    memo: row.memo,
  }))
  const origin = typeof window === 'undefined' ? 'https://cheetahs-club.pages.dev' : window.location.origin

  async function onRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    setNotice(null)
    const result = await syncFinanceSheet(false)
    setRefreshing(false)
    if (result.error) {
      setRefreshError(result.error)
      setToken((value) => value + 1)
      return
    }
    setNotice(result.notice)
    setToken((value) => value + 1)
  }

  return (
    <SheetDuesView
      loading={loading}
      error={error}
      notice={notice}
      memberName={memberName}
      ledger={ledger}
      expenses={expenses}
      syncedAt={desk.meta?.syncedAt ?? null}
      lastAttemptFailed={desk.meta?.lastAttemptFailed ?? false}
      lastAttemptAt={desk.meta?.lastAttemptAt ?? null}
      syncSource={desk.meta?.syncSource ?? null}
      syncError={desk.status?.syncError ?? null}
      zelleEmail={desk.settings.zelleEmail}
      memo={zelleMemo(memberName, desk.memo?.memoToken ?? null, desk.settings.reminderMmdd)}
      showSync={isAdmin}
      refreshing={refreshing}
      refreshError={refreshError}
      onRefresh={() => void onRefresh()}
      duesLink={staff ? duesUrl(origin, memberId) : null}
      wrongLink={wrongLink}
      invalidLink={invalidLink}
      absentLabel={
        viewingSelf
          ? 'Your name is not on the latest club sheet. A captain can link the sheet name to you.'
          : 'This member is not on the latest club sheet.'
      }
    />
  )
}
